-- Every in-app notification is also e-mailed, unless the person turned it off.
--
-- 1. profiles.email_notifications_enabled (default true). Service messages
--    about the person's own activity, not marketing; the privacy policy says
--    so, and every message carries a one-click opt-out.
-- 2. An AFTER INSERT trigger on notifications queues one row per notification
--    in notification_emails, whoever inserted it (the pledge, signup, claim,
--    event and need transactions, and the nearby-notification worker). The
--    day-before reminder (reminder_event_id) is skipped: the event-reminders
--    cron already e-mails it.
-- 3. claim_notification_email_batches() hands the worker one batch per
--    recipient: up to ten due notifications, and at most one e-mail per
--    person every ten minutes, so a burst of pledges becomes one message.
--    Each batch carries a fresh unsubscribe token; only its SHA-256 digest is
--    stored (notification_email_unsubscribe_tokens), so every link ever sent
--    keeps working until the digest ages out after 400 days.
-- 4. complete_notification_email_batch() records sent / retry (exponential
--    backoff, failed after five attempts) / skipped; rows a worker claimed
--    and never completed become due again after their backoff.
-- 5. unsubscribe_notification_emails(digest) and set_email_notifications()
--    turn e-mail off (or on) and drop anything still queued.
-- Sent, skipped and failed rows are deleted after 90 days, and anything still
-- queued after three days is skipped rather than sent late.
-- All functions are service_role only; the tables are not exposed.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.notification_emails (
  notification_id uuid PRIMARY KEY REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  batch_id uuid,
  sent_at timestamptz,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_emails_due
  ON public.notification_emails (next_attempt_at)
  WHERE status IN ('pending', 'sending');
CREATE INDEX IF NOT EXISTS idx_notification_emails_user_sent
  ON public.notification_emails (user_id, sent_at DESC)
  WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_notification_emails_batch
  ON public.notification_emails (batch_id)
  WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notification_emails_created
  ON public.notification_emails (created_at);

CREATE TABLE IF NOT EXISTS public.notification_email_unsubscribe_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_email_unsubscribe_tokens_created
  ON public.notification_email_unsubscribe_tokens (created_at);

ALTER TABLE public.notification_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_emails FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notification_email_unsubscribe_tokens FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_notification_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- The day-before reminder is e-mailed by the event-reminders cron itself.
  IF NEW.reminder_event_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_emails (notification_id, user_id)
  SELECT NEW.id, NEW.user_id
  FROM public.profiles p
  WHERE p.id = NEW.user_id
    AND p.email_notifications_enabled
  ON CONFLICT (notification_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_notification_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notifications_enqueue_email ON public.notifications;
CREATE TRIGGER notifications_enqueue_email
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_notification_email();

CREATE OR REPLACE FUNCTION public.claim_notification_email_batches(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_now timestamptz := clock_timestamp();
  v_result jsonb := '[]'::jsonb;
  v_user uuid;
  v_profile record;
  v_batch uuid;
  v_token text;
  v_items jsonb;
  v_claimed integer;
BEGIN
  -- Housekeeping, bounded per call.
  DELETE FROM public.notification_emails e
  WHERE e.ctid IN (
    SELECT old.ctid FROM public.notification_emails old
    WHERE old.status IN ('sent', 'skipped', 'failed')
      AND old.created_at < v_now - interval '90 days'
    LIMIT 500
  );
  DELETE FROM public.notification_email_unsubscribe_tokens t
  WHERE t.ctid IN (
    SELECT old.ctid FROM public.notification_email_unsubscribe_tokens old
    WHERE old.created_at < v_now - interval '400 days'
    LIMIT 500
  );

  -- Nothing is sent late or to someone who has since turned e-mail off.
  UPDATE public.notification_emails e
  SET status = 'skipped', last_error = 'expired'
  WHERE e.status IN ('pending', 'sending')
    AND e.created_at < v_now - interval '3 days';
  UPDATE public.notification_emails e
  SET status = 'skipped', last_error = 'disabled'
  FROM public.profiles p
  WHERE p.id = e.user_id
    AND e.status IN ('pending', 'sending')
    AND NOT p.email_notifications_enabled;
  -- A claimed batch that never completed and has used its attempts.
  UPDATE public.notification_emails e
  SET status = 'failed', last_error = coalesce(e.last_error, 'not completed')
  WHERE e.status IN ('pending', 'sending')
    AND e.attempts >= 5
    AND e.next_attempt_at <= v_now;

  FOR v_user IN
    SELECT due.user_id
    FROM public.notification_emails due
    WHERE due.status IN ('pending', 'sending')
      AND due.next_attempt_at <= v_now
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_emails recent
        WHERE recent.user_id = due.user_id
          AND recent.status = 'sent'
          AND recent.sent_at > v_now - interval '10 minutes'
      )
    GROUP BY due.user_id
    ORDER BY min(due.created_at)
    LIMIT v_limit
  LOOP
    SELECT p.email, p.name INTO v_profile
    FROM public.profiles p
    WHERE p.id = v_user;

    IF NOT FOUND OR coalesce(btrim(v_profile.email), '') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      UPDATE public.notification_emails e
      SET status = 'skipped', last_error = 'no address'
      WHERE e.user_id = v_user AND e.status IN ('pending', 'sending');
      CONTINUE;
    END IF;

    v_batch := gen_random_uuid();

    UPDATE public.notification_emails e
    SET status = 'sending',
        batch_id = v_batch,
        attempts = e.attempts + 1,
        -- If this worker never reports back, the rows come due again.
        next_attempt_at = v_now + interval '5 minutes' * power(2, least(e.attempts, 4))
    WHERE e.notification_id IN (
      SELECT pick.notification_id
      FROM public.notification_emails pick
      WHERE pick.user_id = v_user
        AND pick.status IN ('pending', 'sending')
        AND pick.next_attempt_at <= v_now
      ORDER BY pick.created_at
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS v_claimed = ROW_COUNT;
    IF v_claimed = 0 THEN
      CONTINUE;
    END IF;

    -- The raw token only travels in this result and in the e-mail.
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    INSERT INTO public.notification_email_unsubscribe_tokens (token_hash, user_id)
    VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_user);

    SELECT jsonb_agg(
      jsonb_build_object(
        'id', n.id,
        'title', n.title,
        'body', n.body,
        'link', n.link,
        'created_at', n.created_at
      ) ORDER BY n.created_at
    )
    INTO v_items
    FROM public.notification_emails e
    JOIN public.notifications n ON n.id = e.notification_id
    WHERE e.batch_id = v_batch;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'batch_id', v_batch,
      'email', btrim(v_profile.email),
      'name', v_profile.name,
      'unsubscribe_token', v_token,
      'items', coalesce(v_items, '[]'::jsonb)
    ));
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_email_batches(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_email_batches(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_notification_email_batch(
  p_batch_id uuid,
  p_outcome text,
  p_error text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 300);
  v_count integer;
BEGIN
  IF p_batch_id IS NULL OR p_outcome NOT IN ('sent', 'retry', 'skipped') THEN
    RAISE EXCEPTION 'invalid e-mail batch outcome' USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'sent' THEN
    UPDATE public.notification_emails e
    SET status = 'sent', sent_at = v_now, last_error = NULL
    WHERE e.batch_id = p_batch_id AND e.status = 'sending';
  ELSIF p_outcome = 'skipped' THEN
    UPDATE public.notification_emails e
    SET status = 'skipped', last_error = coalesce(v_error, 'skipped')
    WHERE e.batch_id = p_batch_id AND e.status = 'sending';
  ELSE
    UPDATE public.notification_emails e
    SET status = CASE WHEN e.attempts >= 5 THEN 'failed' ELSE 'pending' END,
        last_error = coalesce(v_error, 'send failed'),
        next_attempt_at = v_now + interval '2 minutes' * power(2, least(e.attempts, 5))
    WHERE e.batch_id = p_batch_id AND e.status = 'sending';
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_notification_email_batch(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_notification_email_batch(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.unsubscribe_notification_emails(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  SELECT t.user_id INTO v_user
  FROM public.notification_email_unsubscribe_tokens t
  WHERE t.token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.profiles p
  SET email_notifications_enabled = false
  WHERE p.id = v_user;

  UPDATE public.notification_emails e
  SET status = 'skipped', last_error = 'disabled'
  WHERE e.user_id = v_user AND e.status IN ('pending', 'sending');

  PERFORM public.append_audit_log_event(
    v_user, NULL, 'notification_email.unsubscribe', 'profile', v_user,
    jsonb_build_object('via', 'email_link')
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.unsubscribe_notification_emails(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unsubscribe_notification_emails(text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_email_notifications(p_actor_id uuid, p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled must be true or false' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles p
  SET email_notifications_enabled = p_enabled
  WHERE p.id = p_actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT p_enabled THEN
    UPDATE public.notification_emails e
    SET status = 'skipped', last_error = 'disabled'
    WHERE e.user_id = p_actor_id AND e.status IN ('pending', 'sending');
  END IF;

  PERFORM public.append_audit_log_event(
    p_actor_id, NULL, 'notification_email.preference', 'profile', p_actor_id,
    jsonb_build_object('enabled', p_enabled)
  );

  RETURN p_enabled;
END;
$$;

REVOKE ALL ON FUNCTION public.set_email_notifications(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_email_notifications(uuid, boolean) TO service_role;

COMMIT;
