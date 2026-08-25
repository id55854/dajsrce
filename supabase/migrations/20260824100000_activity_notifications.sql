-- In-app activity notifications for the events an account actually cares
-- about, on top of the existing nearby-donor outbox:
--
--   * An NGO's staff get one when a citizen pledges against one of their
--     needs, and one when a citizen signs up for one of their volunteer
--     events. Both piggyback on the existing transactional RPCs so the
--     notification is written in the same transaction as the pledge/signup
--     — no separate outbox, no partial-failure window.
--
--   * An individual who signed up for a volunteer event gets a reminder the
--     day before it happens. There is no natural write-time trigger for
--     "tomorrow", so this one is a scheduled RPC driven by a new cron route,
--     the same shape as auto-acknowledge. `reminder_event_id` plus a unique
--     index on (reminder_event_id, user_id) makes a retried or re-run tick
--     a no-op instead of a duplicate notification.
--
-- The bell badge in the navbar already counts unread rows in `notifications`
-- for whoever is signed in — individual or NGO — so nothing there needs to
-- change; it was just never fed by these three events.

BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS reminder_event_id uuid
    REFERENCES public.volunteer_events(id) ON DELETE CASCADE;

-- Postgres treats every NULL as distinct in a unique index, so this only
-- constrains the reminder rows (which always set the column) and leaves
-- every other notification kind, including NULL-reminder rows, unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_reminder_event_user
  ON public.notifications(reminder_event_id, user_id);

-- ---------------------------------------------------------------------------
-- Pledge created -> notify the need's institution staff.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_pledge_transaction(
  p_user_id uuid,
  p_need_id uuid,
  p_quantity integer,
  p_message text DEFAULT NULL,
  p_tax_category text DEFAULT 'humanitarian',
  p_amount_eur numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_need public.needs%ROWTYPE;
  v_pledge public.pledges%ROWTYPE;
  v_new_pledged integer;
  v_donor_name text;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '23503';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000000 THEN
    RAISE EXCEPTION 'quantity must be an integer between 1 and 1000000' USING ERRCODE = '22023';
  END IF;
  IF p_message IS NOT NULL AND length(p_message) > 2000 THEN
    RAISE EXCEPTION 'message too long' USING ERRCODE = '22023';
  END IF;
  IF p_tax_category NOT IN (
    'cultural', 'scientific', 'educational', 'health', 'humanitarian',
    'sports', 'religious', 'environmental', 'other_public_benefit'
  ) THEN
    RAISE EXCEPTION 'invalid tax category' USING ERRCODE = '22023';
  END IF;
  IF p_amount_eur IS NOT NULL AND (p_amount_eur < 0 OR p_amount_eur > 1000000000) THEN
    RAISE EXCEPTION 'invalid amount' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_need FROM public.needs WHERE id = p_need_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'need not found' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(v_need.is_fulfilled, false) THEN
    RAISE EXCEPTION 'need is already fulfilled' USING ERRCODE = '23514';
  END IF;

  IF v_need.quantity_needed IS NOT NULL
     AND coalesce(v_need.quantity_pledged, 0) + p_quantity > v_need.quantity_needed THEN
    RAISE EXCEPTION 'pledge exceeds remaining quantity' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.pledges(
    user_id, need_id, quantity, message, status, tax_category, amount_eur
  ) VALUES (
    p_user_id, p_need_id, p_quantity, nullif(trim(p_message), ''), 'pledged',
    p_tax_category,
    CASE WHEN p_amount_eur IS NULL THEN NULL ELSE round(p_amount_eur, 2) END
  ) RETURNING * INTO v_pledge;

  v_new_pledged := coalesce(v_need.quantity_pledged, 0) + p_quantity;
  UPDATE public.needs
  SET quantity_pledged = v_new_pledged,
      is_fulfilled = CASE
        WHEN quantity_needed IS NOT NULL AND v_new_pledged >= quantity_needed THEN true
        ELSE is_fulfilled
      END
  WHERE id = p_need_id;

  UPDATE public.profiles
  SET total_pledges = coalesce(total_pledges, 0) + 1
  WHERE id = p_user_id;

  SELECT name INTO v_donor_name FROM public.profiles WHERE id = p_user_id;
  INSERT INTO public.notifications (user_id, title, body, link)
  SELECT
    p.id,
    'Novo obećanje',
    format(
      'Primili ste obećanje za "%s" od korisnika %s (količina: %s).',
      v_need.title, coalesce(v_donor_name, 'korisnik'), p_quantity
    ),
    '/dashboard/institution/pledges'
  FROM public.profiles p
  WHERE p.institution_id = v_need.institution_id AND p.role = 'ngo';

  RETURN jsonb_build_object(
    'pledge', to_jsonb(v_pledge),
    'match_pledge_id', NULL,
    'need', jsonb_build_object('id', v_need.id, 'quantity_pledged', v_new_pledged)
  );
END;
$$;

-- CREATE OR REPLACE keeps the existing grants; the signature is unchanged.

-- ---------------------------------------------------------------------------
-- Volunteer signup created -> notify the event's institution staff.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.volunteer_signup_transaction(
  p_user_id uuid,
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.volunteer_events%ROWTYPE;
  v_count integer;
  v_signup public.volunteer_signups%ROWTYPE;
  v_volunteer_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '23503';
  END IF;
  SELECT * INTO v_event FROM public.volunteer_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event not found' USING ERRCODE = 'P0002'; END IF;
  IF v_event.event_date < current_date THEN
    RAISE EXCEPTION 'event has ended' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_signup FROM public.volunteer_signups
  WHERE user_id = p_user_id AND event_id = p_event_id
  FOR UPDATE;
  IF v_signup.id IS NOT NULL AND v_signup.cancelled_at IS NULL THEN
    RAISE EXCEPTION 'already signed up' USING ERRCODE = '23505';
  END IF;

  SELECT count(*)::integer INTO v_count FROM public.volunteer_signups
  WHERE event_id = p_event_id AND cancelled_at IS NULL;
  IF v_count >= v_event.volunteers_needed THEN
    RAISE EXCEPTION 'event is full' USING ERRCODE = '23514';
  END IF;

  IF v_signup.id IS NOT NULL THEN
    UPDATE public.volunteer_signups
    SET cancelled_at = NULL
    WHERE id = v_signup.id
    RETURNING * INTO v_signup;
  ELSE
    INSERT INTO public.volunteer_signups(user_id, event_id)
    VALUES (p_user_id, p_event_id) RETURNING * INTO v_signup;
  END IF;

  UPDATE public.volunteer_events SET volunteers_signed_up = v_count + 1 WHERE id = p_event_id;

  SELECT name INTO v_volunteer_name FROM public.profiles WHERE id = p_user_id;
  INSERT INTO public.notifications (user_id, title, body, link)
  SELECT
    p.id,
    'Nova prijava na volonterski događaj',
    format(
      'Zaprimili ste novu prijavu za "%s" (%s): %s.',
      v_event.title,
      to_char(v_event.event_date::timestamp, 'DD.MM.YYYY.'),
      coalesce(v_volunteer_name, 'korisnik')
    ),
    '/dashboard/institution/volunteers'
  FROM public.profiles p
  WHERE p.institution_id = v_event.institution_id AND p.role = 'ngo';

  RETURN to_jsonb(v_signup);
END;
$$;

-- CREATE OR REPLACE keeps the existing grants; the signature is unchanged.

-- ---------------------------------------------------------------------------
-- Scheduled: remind tomorrow's volunteers. Driven by
-- POST /api/cron/event-reminders, same bearer-secret shape as
-- auto-acknowledge. ON CONFLICT DO NOTHING makes a repeated or overlapping
-- run harmless.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_volunteer_event_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.notifications (user_id, title, body, link, reminder_event_id)
  SELECT
    s.user_id,
    'Podsjetnik: volonterski događaj sutra',
    format(
      '"%s" počinje sutra (%s) u %s.',
      e.title,
      to_char(e.event_date::timestamp, 'DD.MM.YYYY.'),
      substring(e.start_time::text, 1, 5)
    ),
    '/dashboard/individual',
    e.id
  FROM public.volunteer_events e
  JOIN public.volunteer_signups s ON s.event_id = e.id AND s.cancelled_at IS NULL
  WHERE e.event_date = current_date + 1
  ON CONFLICT (reminder_event_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.send_volunteer_event_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_volunteer_event_reminders() TO service_role;

COMMIT;
