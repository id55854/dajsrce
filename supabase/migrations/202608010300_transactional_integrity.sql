-- Transactional integrity, idempotency, and evidence foundations.
-- It also normalizes duplicate legacy attendance rows before enforcing the
-- new one-session/one-evidence invariant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Domain constraints and hot indexes. NOT VALID preserves deployability when
-- historic rows require cleanup while still protecting all new writes.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pledges_quantity_positive') THEN
    ALTER TABLE public.pledges
      ADD CONSTRAINT pledges_quantity_positive
      CHECK (quantity BETWEEN 1 AND 1000000) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pledges_amount_nonnegative') THEN
    ALTER TABLE public.pledges
      ADD CONSTRAINT pledges_amount_nonnegative
      CHECK (amount_eur IS NULL OR amount_eur BETWEEN 0 AND 1000000000) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pledges_tax_category_known') THEN
    ALTER TABLE public.pledges
      ADD CONSTRAINT pledges_tax_category_known
      CHECK (tax_category IN (
        'cultural', 'scientific', 'educational', 'health', 'humanitarian',
        'sports', 'religious', 'environmental', 'other_public_benefit'
      )) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'needs_quantities_nonnegative') THEN
    ALTER TABLE public.needs
      ADD CONSTRAINT needs_quantities_nonnegative
      CHECK (
        (quantity_needed IS NULL OR quantity_needed >= 0)
        AND coalesce(quantity_pledged, 0) >= 0
        AND coalesce(quantity_delivered, 0) >= 0
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'volunteer_event_capacity_positive') THEN
    ALTER TABLE public.volunteer_events
      ADD CONSTRAINT volunteer_event_capacity_positive
      CHECK (volunteers_needed > 0 AND coalesce(volunteers_signed_up, 0) >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_match_ratio_bounded') THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT company_match_ratio_bounded
      CHECK (default_match_ratio BETWEEN 0 AND 10) NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_profiles_institution
  ON public.profiles(institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_needs_active_urgency_created
  ON public.needs(urgency, created_at DESC) WHERE is_fulfilled = false;
CREATE INDEX IF NOT EXISTS idx_pledges_match_of
  ON public.pledges(match_of_pledge_id) WHERE match_of_pledge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pledges_company_status_created
  ON public.pledges(company_id, status, created_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_volunteer_events_institution_date
  ON public.volunteer_events(institution_id, event_date);
CREATE INDEX IF NOT EXISTS idx_volunteer_signups_event
  ON public.volunteer_signups(event_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_signups_company_checkout
  ON public.volunteer_signups(company_id, checked_out_at) WHERE company_id IS NOT NULL;

-- Earlier checkout retries could record the same attendance session more
-- than once. Keep the first evidence row before enforcing one row per signup.
WITH duplicate_hours AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY volunteer_signup_id
           ORDER BY recorded_at, id
         ) AS duplicate_rank
  FROM public.volunteer_hours
)
DELETE FROM public.volunteer_hours h
USING duplicate_hours d
WHERE h.id = d.id AND d.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_volunteer_hours_signup
  ON public.volunteer_hours(volunteer_signup_id);

-- ---------------------------------------------------------------------------
-- Canonical, serialized audit append. The hash covers the complete event
-- envelope and an advisory transaction lock prevents company-chain forks.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.append_audit_log_event(
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_action text,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_id bigint;
  v_prev_hash text;
  v_created_at timestamptz := clock_timestamp();
  v_hash text;
  v_envelope jsonb;
BEGIN
  IF p_action IS NULL OR length(trim(p_action)) = 0 OR length(p_action) > 160 THEN
    RAISE EXCEPTION 'invalid audit action' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(coalesce(p_company_id::text, 'global'), 724173)
  );

  SELECT hash INTO v_prev_hash
  FROM public.audit_log
  WHERE company_id IS NOT DISTINCT FROM p_company_id
  ORDER BY id DESC
  LIMIT 1;

  v_envelope := jsonb_build_object(
    'actor_profile_id', p_actor_profile_id,
    'company_id', p_company_id,
    'action', trim(p_action),
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'payload', coalesce(p_payload, '{}'::jsonb),
    'previous_hash', v_prev_hash,
    'created_at', to_char(v_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );
  v_hash := encode(digest(convert_to(v_envelope::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.audit_log(
    actor_profile_id, company_id, action, entity_type, entity_id,
    payload, prev_hash, hash, created_at
  ) VALUES (
    p_actor_profile_id, p_company_id, trim(p_action), p_entity_type, p_entity_id,
    coalesce(p_payload, '{}'::jsonb), v_prev_hash, v_hash, v_created_at
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_audit_log_event(uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_audit_log_event(uuid, uuid, text, text, uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Atomic pledge state machine.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_pledge_transaction(
  p_user_id uuid,
  p_need_id uuid,
  p_quantity integer,
  p_message text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_campaign_id uuid DEFAULT NULL,
  p_request_match boolean DEFAULT false,
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
  v_match public.pledges%ROWTYPE;
  v_match_ratio numeric := 0;
  v_match_quantity integer := 0;
  v_total_quantity integer;
  v_new_pledged integer;
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

  IF p_company_id IS NOT NULL THEN
    SELECT c.default_match_ratio INTO v_match_ratio
    FROM public.companies c
    JOIN public.company_members m ON m.company_id = c.id
    WHERE c.id = p_company_id AND m.profile_id = p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not a member of this company' USING ERRCODE = '42501';
    END IF;
    IF v_match_ratio < 0 OR v_match_ratio > 10 THEN
      RAISE EXCEPTION 'company match ratio is invalid' USING ERRCODE = '23514';
    END IF;
    IF p_campaign_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE id = p_campaign_id AND company_id = p_company_id AND is_active = true
    ) THEN
      RAISE EXCEPTION 'campaign not found for company' USING ERRCODE = '23503';
    END IF;
  ELSIF p_campaign_id IS NOT NULL THEN
    RAISE EXCEPTION 'campaign requires company' USING ERRCODE = '22023';
  END IF;

  IF p_request_match AND p_company_id IS NOT NULL AND v_match_ratio > 0 THEN
    v_match_quantity := greatest(1, round(p_quantity * v_match_ratio)::integer);
  END IF;
  v_total_quantity := p_quantity + v_match_quantity;

  IF v_need.quantity_needed IS NOT NULL
     AND coalesce(v_need.quantity_pledged, 0) + v_total_quantity > v_need.quantity_needed THEN
    RAISE EXCEPTION 'pledge exceeds remaining quantity' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.pledges(
    user_id, need_id, quantity, message, status, company_id, campaign_id,
    tax_category, amount_eur
  ) VALUES (
    p_user_id, p_need_id, p_quantity, nullif(trim(p_message), ''), 'pledged',
    p_company_id, p_campaign_id, p_tax_category,
    CASE WHEN p_amount_eur IS NULL THEN NULL ELSE round(p_amount_eur, 2) END
  ) RETURNING * INTO v_pledge;

  IF v_match_quantity > 0 THEN
    INSERT INTO public.pledges(
      user_id, need_id, quantity, message, status, company_id, campaign_id,
      match_of_pledge_id, tax_category, amount_eur
    ) VALUES (
      p_user_id, p_need_id, v_match_quantity, 'Company match', 'pledged',
      p_company_id, p_campaign_id, v_pledge.id, p_tax_category,
      CASE WHEN p_amount_eur IS NULL THEN NULL ELSE round(p_amount_eur * v_match_ratio, 2) END
    ) RETURNING * INTO v_match;
  END IF;

  v_new_pledged := coalesce(v_need.quantity_pledged, 0) + v_total_quantity;
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

  IF p_company_id IS NOT NULL THEN
    PERFORM public.append_audit_log_event(
      p_user_id, p_company_id, 'pledge.create', 'pledge', v_pledge.id,
      jsonb_build_object(
        'need_id', p_need_id,
        'quantity', p_quantity,
        'campaign_id', p_campaign_id,
        'match_pledge_id', v_match.id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'pledge', to_jsonb(v_pledge),
    'match_pledge_id', v_match.id,
    'need', jsonb_build_object('id', p_need_id, 'quantity_pledged', v_new_pledged)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_pledge_transaction(uuid, uuid, integer, text, uuid, uuid, boolean, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pledge_transaction(uuid, uuid, integer, text, uuid, uuid, boolean, text, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_pledge_delivered_transaction(
  p_actor_id uuid,
  p_pledge_id uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_pledge public.pledges%ROWTYPE;
  v_institution_id uuid;
  v_actor_institution_id uuid;
  v_actor_role text;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_pledge FROM public.pledges WHERE id = p_pledge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pledge not found' USING ERRCODE = 'P0002'; END IF;
  IF v_pledge.status <> 'pledged' THEN
    RAISE EXCEPTION 'pledge is not in pledged status' USING ERRCODE = '23514';
  END IF;

  SELECT n.institution_id INTO v_institution_id FROM public.needs n WHERE n.id = v_pledge.need_id;
  SELECT institution_id, role INTO v_actor_institution_id, v_actor_role
  FROM public.profiles WHERE id = p_actor_id;
  IF v_pledge.user_id <> p_actor_id
     AND NOT (v_actor_role = 'ngo' AND v_actor_institution_id = v_institution_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pledges SET status = 'delivered', delivered_at = v_now
  WHERE id = p_pledge_id;
  IF v_pledge.company_id IS NOT NULL THEN
    PERFORM public.append_audit_log_event(
      p_actor_id, v_pledge.company_id, 'pledge.deliver', 'pledge', p_pledge_id,
      jsonb_build_object('delivered_at', v_now)
    );
  END IF;
  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_pledge_delivered_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_pledge_delivered_transaction(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.acknowledge_pledge_transaction(
  p_actor_id uuid,
  p_pledge_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_pledge public.pledges%ROWTYPE;
  v_actor_institution_id uuid;
  v_actor_role text;
  v_need_institution_id uuid;
  v_signed_at timestamptz := clock_timestamp();
  v_hash text;
  v_ack public.pledge_acknowledgements%ROWTYPE;
BEGIN
  IF p_notes IS NOT NULL AND length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'notes too long' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_pledge FROM public.pledges WHERE id = p_pledge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pledge not found' USING ERRCODE = 'P0002'; END IF;
  IF v_pledge.status <> 'delivered' THEN
    RAISE EXCEPTION 'pledge must be delivered first' USING ERRCODE = '23514';
  END IF;
  SELECT institution_id, role INTO v_actor_institution_id, v_actor_role
  FROM public.profiles WHERE id = p_actor_id;
  SELECT institution_id INTO v_need_institution_id FROM public.needs WHERE id = v_pledge.need_id;
  IF v_actor_role <> 'ngo' OR v_actor_institution_id IS DISTINCT FROM v_need_institution_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pledge_acknowledgements WHERE pledge_id = p_pledge_id) THEN
    RAISE EXCEPTION 'already acknowledged' USING ERRCODE = '23505';
  END IF;

  v_hash := encode(digest(convert_to(concat_ws('|', p_pledge_id, p_actor_id, v_signed_at, coalesce(p_notes, '')), 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.pledge_acknowledgements(
    pledge_id, institution_user_id, signed_at, kind, notes, signature_hash
  ) VALUES (
    p_pledge_id, p_actor_id, v_signed_at, 'manual', nullif(trim(p_notes), ''), v_hash
  ) RETURNING * INTO v_ack;
  UPDATE public.pledges SET status = 'confirmed', fulfilled_at = v_signed_at
  WHERE id = p_pledge_id;
  IF v_pledge.company_id IS NOT NULL THEN
    PERFORM public.append_audit_log_event(
      p_actor_id, v_pledge.company_id, 'pledge.acknowledge', 'pledge', p_pledge_id,
      jsonb_build_object('acknowledgement_id', v_ack.id, 'kind', 'manual')
    );
  END IF;
  RETURN to_jsonb(v_ack);
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_pledge_transaction(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_pledge_transaction(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Atomic volunteer capacity and attendance state machine.
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
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '23503';
  END IF;
  SELECT * INTO v_event FROM public.volunteer_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event not found' USING ERRCODE = 'P0002'; END IF;
  IF v_event.event_date < current_date THEN
    RAISE EXCEPTION 'event has ended' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.volunteer_signups WHERE user_id = p_user_id AND event_id = p_event_id) THEN
    RAISE EXCEPTION 'already signed up' USING ERRCODE = '23505';
  END IF;
  SELECT count(*)::integer INTO v_count FROM public.volunteer_signups WHERE event_id = p_event_id;
  IF v_count >= v_event.volunteers_needed THEN
    RAISE EXCEPTION 'event is full' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.volunteer_signups(user_id, event_id)
  VALUES (p_user_id, p_event_id) RETURNING * INTO v_signup;
  UPDATE public.volunteer_events SET volunteers_signed_up = v_count + 1 WHERE id = p_event_id;
  RETURN to_jsonb(v_signup);
END;
$$;

REVOKE ALL ON FUNCTION public.volunteer_signup_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_signup_transaction(uuid, uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.volunteer_checkin_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.volunteer_events(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(token_hash) = 64),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_volunteer_checkin_tokens_event_active
  ON public.volunteer_checkin_tokens(event_id, expires_at)
  WHERE revoked_at IS NULL;
ALTER TABLE public.volunteer_checkin_tokens ENABLE ROW LEVEL SECURITY;
-- Service routes are the only reader/writer. A bearer token is never stored.
REVOKE ALL ON public.volunteer_checkin_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.volunteer_checkin_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.volunteer_staff_checkin_transaction(
  p_actor_id uuid,
  p_signup_id uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_signup public.volunteer_signups%ROWTYPE;
  v_event_institution uuid;
  v_actor_institution uuid;
  v_actor_role text;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_signup FROM public.volunteer_signups WHERE id = p_signup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'signup not found' USING ERRCODE = 'P0002'; END IF;
  SELECT institution_id INTO v_event_institution FROM public.volunteer_events WHERE id = v_signup.event_id;
  SELECT institution_id, role INTO v_actor_institution, v_actor_role FROM public.profiles WHERE id = p_actor_id;
  IF v_actor_role <> 'ngo' OR v_actor_institution IS DISTINCT FROM v_event_institution THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_signup.checked_out_at IS NOT NULL THEN RAISE EXCEPTION 'session completed' USING ERRCODE = '23514'; END IF;
  IF v_signup.checked_in_at IS NOT NULL THEN RETURN v_signup.checked_in_at; END IF;
  UPDATE public.volunteer_signups SET checked_in_at = v_now WHERE id = p_signup_id;
  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.volunteer_staff_checkin_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_staff_checkin_transaction(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.volunteer_self_checkin_transaction(
  p_user_id uuid,
  p_event_id uuid,
  p_token_hash text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_signup public.volunteer_signups%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 OR NOT EXISTS (
    SELECT 1 FROM public.volunteer_checkin_tokens
    WHERE event_id = p_event_id AND token_hash = p_token_hash
      AND revoked_at IS NULL AND expires_at > v_now
  ) THEN
    RAISE EXCEPTION 'invalid or expired check-in token' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_signup FROM public.volunteer_signups
  WHERE user_id = p_user_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'signup not found' USING ERRCODE = 'P0002'; END IF;
  IF v_signup.checked_out_at IS NOT NULL THEN RAISE EXCEPTION 'session completed' USING ERRCODE = '23514'; END IF;
  IF v_signup.checked_in_at IS NOT NULL THEN RETURN v_signup.checked_in_at; END IF;
  UPDATE public.volunteer_signups SET checked_in_at = v_now WHERE id = v_signup.id;
  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.volunteer_self_checkin_transaction(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_self_checkin_transaction(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.volunteer_checkout_transaction(
  p_actor_id uuid,
  p_signup_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_signup public.volunteer_signups%ROWTYPE;
  v_event_institution uuid;
  v_actor_institution uuid;
  v_actor_role text;
  v_now timestamptz := clock_timestamp();
  v_hours numeric(12,2);
  v_existing_hours numeric(12,2);
BEGIN
  SELECT * INTO v_signup FROM public.volunteer_signups WHERE id = p_signup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'signup not found' USING ERRCODE = 'P0002'; END IF;
  SELECT institution_id INTO v_event_institution FROM public.volunteer_events WHERE id = v_signup.event_id;
  SELECT institution_id, role INTO v_actor_institution, v_actor_role FROM public.profiles WHERE id = p_actor_id;
  IF v_actor_role <> 'ngo' OR v_actor_institution IS DISTINCT FROM v_event_institution THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_signup.checked_in_at IS NULL THEN RAISE EXCEPTION 'check in first' USING ERRCODE = '23514'; END IF;
  IF v_signup.checked_out_at IS NOT NULL THEN
    SELECT hours INTO v_existing_hours FROM public.volunteer_hours WHERE volunteer_signup_id = p_signup_id;
    RETURN jsonb_build_object(
      'checked_out_at', v_signup.checked_out_at,
      'hours', v_existing_hours,
      'already', true
    );
  END IF;

  v_hours := round(least(36::numeric, greatest(0.01::numeric,
    extract(epoch FROM (v_now - v_signup.checked_in_at))::numeric / 3600
  )), 2);
  UPDATE public.volunteer_signups SET checked_out_at = v_now WHERE id = p_signup_id;
  INSERT INTO public.volunteer_hours(
    volunteer_signup_id, user_id, institution_id, company_id,
    hours, recorded_by, recorded_at
  ) VALUES (
    p_signup_id, v_signup.user_id, v_event_institution, v_signup.company_id,
    v_hours, p_actor_id, v_now
  );
  RETURN jsonb_build_object('checked_out_at', v_now, 'hours', v_hours, 'already', false);
END;
$$;

REVOKE ALL ON FUNCTION public.volunteer_checkout_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_checkout_transaction(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Stripe event retry state. Existing rows were previously treated as already
-- processed, so mark them succeeded during the upgrade.
-- ---------------------------------------------------------------------------

ALTER TABLE public.stripe_events
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.stripe_events ALTER COLUMN processed_at DROP NOT NULL;
ALTER TABLE public.stripe_events ALTER COLUMN processed_at DROP DEFAULT;
UPDATE public.stripe_events SET status = 'succeeded' WHERE status IS NULL;
ALTER TABLE public.stripe_events ALTER COLUMN status SET DEFAULT 'received';
ALTER TABLE public.stripe_events ALTER COLUMN status SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stripe_events_status_known') THEN
    ALTER TABLE public.stripe_events ADD CONSTRAINT stripe_events_status_known
      CHECK (status IN ('received', 'processing', 'succeeded', 'failed'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_stripe_event(
  p_event_id text,
  p_type text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
  v_claimed boolean := false;
BEGIN
  INSERT INTO public.stripe_events(id, type, payload, status, attempt_count, processed_at, updated_at)
  VALUES (p_event_id, p_type, coalesce(p_payload, '{}'::jsonb), 'received', 0, NULL, now())
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.stripe_events
  SET status = 'processing',
      attempt_count = attempt_count + 1,
      last_error = NULL,
      updated_at = now()
  WHERE id = p_event_id
    AND (
      status IN ('received', 'failed')
      OR (status = 'processing' AND updated_at < now() - interval '10 minutes')
    )
  RETURNING status INTO v_status;
  v_claimed := FOUND;

  IF NOT v_claimed THEN
    SELECT status INTO v_status FROM public.stripe_events WHERE id = p_event_id;
  END IF;
  RETURN jsonb_build_object('claimed', v_claimed, 'status', v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_stripe_event(
  p_event_id text,
  p_succeeded boolean,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.stripe_events
  SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
      processed_at = CASE WHEN p_succeeded THEN now() ELSE NULL END,
      last_error = CASE WHEN p_succeeded THEN NULL ELSE left(coalesce(p_error, 'unknown failure'), 2000) END,
      updated_at = now()
  WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'stripe event not found' USING ERRCODE = 'P0002'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_stripe_event(text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_event(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_stripe_event(text, boolean, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Race-free version reservation for generated evidence artifacts.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.artifact_version_counters (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('receipt', 'esg_export', 'csr_report')),
  scope_key text NOT NULL,
  current_version integer NOT NULL CHECK (current_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, artifact_kind, scope_key)
);
ALTER TABLE public.artifact_version_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.artifact_version_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.artifact_version_counters TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_artifact_version(
  p_company_id uuid,
  p_artifact_kind text,
  p_scope_key text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_version integer;
BEGIN
  IF p_artifact_kind NOT IN ('receipt', 'esg_export', 'csr_report')
     OR p_scope_key IS NULL OR length(p_scope_key) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'invalid artifact version scope' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.artifact_version_counters(company_id, artifact_kind, scope_key, current_version)
  VALUES (p_company_id, p_artifact_kind, p_scope_key, 1)
  ON CONFLICT (company_id, artifact_kind, scope_key)
  DO UPDATE SET current_version = artifact_version_counters.current_version + 1, updated_at = now()
  RETURNING current_version INTO v_version;
  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_artifact_version(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_artifact_version(uuid, text, text) TO service_role;

-- Generation state makes partial artifacts visible to operators but not ready
-- for download. Existing completed rows are backfilled as ready.
ALTER TABLE public.donation_receipts
  ADD COLUMN IF NOT EXISTS generation_status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS generation_error text;
ALTER TABLE public.esg_exports
  ADD COLUMN IF NOT EXISTS generation_status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS generation_error text;
ALTER TABLE public.company_csr_reports
  ADD COLUMN IF NOT EXISTS generation_status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS generation_error text,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'donation_receipts_generation_status') THEN
    ALTER TABLE public.donation_receipts ADD CONSTRAINT donation_receipts_generation_status
      CHECK (generation_status IN ('generating', 'ready', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'esg_exports_generation_status') THEN
    ALTER TABLE public.esg_exports ADD CONSTRAINT esg_exports_generation_status
      CHECK (generation_status IN ('generating', 'ready', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_csr_reports_generation_status') THEN
    ALTER TABLE public.company_csr_reports ADD CONSTRAINT company_csr_reports_generation_status
      CHECK (generation_status IN ('generating', 'ready', 'failed'));
  END IF;
END;
$$;

-- The legacy table had no version column, so give existing rows stable
-- versions before adding the new uniqueness invariant.
DO $$
BEGIN
  IF to_regclass('public.uq_company_csr_report_version') IS NULL THEN
    WITH ranked_reports AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY company_id, period_start, period_end
               ORDER BY generated_at, id
             )::integer AS assigned_version
      FROM public.company_csr_reports
    )
    UPDATE public.company_csr_reports r
    SET version = ranked.assigned_version
    FROM ranked_reports ranked
    WHERE r.id = ranked.id
      AND r.version IS DISTINCT FROM ranked.assigned_version;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_csr_report_version
  ON public.company_csr_reports(company_id, period_start, period_end, version);

-- Start the allocator after every historic artifact version. Without this
-- seed, the first post-migration generation would try version 1 again.
INSERT INTO public.artifact_version_counters AS counters(
  company_id, artifact_kind, scope_key, current_version
)
SELECT company_id, 'receipt', fiscal_year::text, max(version)
FROM public.donation_receipts
GROUP BY company_id, fiscal_year
ON CONFLICT (company_id, artifact_kind, scope_key) DO UPDATE
SET current_version = greatest(
      counters.current_version,
      EXCLUDED.current_version
    ),
    updated_at = now();

INSERT INTO public.artifact_version_counters AS counters(
  company_id, artifact_kind, scope_key, current_version
)
SELECT company_id, 'esg_export',
       framework || ':' || period_start::text || ':' || period_end::text,
       max(version)
FROM public.esg_exports
GROUP BY company_id, framework, period_start, period_end
ON CONFLICT (company_id, artifact_kind, scope_key) DO UPDATE
SET current_version = greatest(
      counters.current_version,
      EXCLUDED.current_version
    ),
    updated_at = now();

INSERT INTO public.artifact_version_counters AS counters(
  company_id, artifact_kind, scope_key, current_version
)
SELECT company_id, 'csr_report',
       period_start::text || ':' || period_end::text,
       max(version)
FROM public.company_csr_reports
GROUP BY company_id, period_start, period_end
ON CONFLICT (company_id, artifact_kind, scope_key) DO UPDATE
SET current_version = greatest(
      counters.current_version,
      EXCLUDED.current_version
    ),
    updated_at = now();

-- ---------------------------------------------------------------------------
-- Uncapped evidence projections. Returning one JSON value avoids PostgREST's
-- row cap while keeping the server-side filter and explicit public columns.
-- These are service-only generation inputs, not browser endpoints.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_acknowledged_pledges_json(
  p_company_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'amount_eur', p.amount_eur,
    'tax_category', p.tax_category,
    'ack_kind', a.kind,
    'ack_signed_at', a.signed_at,
    'need_title', n.title,
    'institution_id', i.id,
    'institution_name', i.name,
    'institution_oib', i.oib
  ) ORDER BY a.signed_at, p.id), '[]'::jsonb)
  FROM public.pledges p
  JOIN public.pledge_acknowledgements a ON a.pledge_id = p.id
  JOIN public.needs n ON n.id = p.need_id
  JOIN public.institutions i ON i.id = n.institution_id
  WHERE p.company_id = p_company_id
    AND p.amount_eur IS NOT NULL
    AND p.amount_eur > 0
    AND a.signed_at >= p_from
    AND a.signed_at <= p_to;
$$;

CREATE OR REPLACE FUNCTION public.get_volunteer_hours_json(
  p_company_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id,
    'hours', h.hours,
    'recorded_at', h.recorded_at,
    'institution_id', h.institution_id,
    'user_id', h.user_id
  ) ORDER BY h.recorded_at, h.id), '[]'::jsonb)
  FROM public.volunteer_hours h
  WHERE h.company_id = p_company_id
    AND h.recorded_at >= p_from
    AND h.recorded_at <= p_to;
$$;

REVOKE ALL ON FUNCTION public.get_acknowledged_pledges_json(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_volunteer_hours_json(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_acknowledged_pledges_json(uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_volunteer_hours_json(uuid, timestamptz, timestamptz) TO service_role;

COMMIT;
