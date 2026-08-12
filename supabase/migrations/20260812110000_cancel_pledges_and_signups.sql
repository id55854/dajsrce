-- Donor-initiated cancellation for pledges and volunteer signups.
--
-- Two shapes of "undo", both of which must leave evidence intact:
--
--   * A pledge may be withdrawn only while it is still a promise. Once it is
--     `delivered` or `confirmed` it is acknowledgement-backed evidence and the
--     donor can no longer take it back. Cancelling releases the reserved
--     quantity on the need (including a company match row created with it),
--     re-derives `is_fulfilled` and gives the donor's counter back.
--
--   * A volunteer signup is NEVER deleted. public.volunteer_hours references
--     public.volunteer_signups ON DELETE CASCADE, so deleting a signup would
--     silently erase the hours already exported as ESG evidence. Cancellation
--     is therefore a nullable `cancelled_at` stamp, and a volunteer who has
--     already checked in cannot cancel at all.
--
-- Both transitions touch several rows, so they live in service-only
-- SECURITY DEFINER RPCs that take the actor and decide ownership themselves.

BEGIN;

-- ---------------------------------------------------------------------------
-- Cancellation state.
-- ---------------------------------------------------------------------------

ALTER TABLE public.pledges
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE public.volunteer_signups
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Capacity, duplicate detection and the volunteer's own list all read the
-- active subset, so index exactly that.
CREATE INDEX IF NOT EXISTS idx_volunteer_signups_event_active
  ON public.volunteer_signups(event_id) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_volunteer_signups_user_active
  ON public.volunteer_signups(user_id) WHERE cancelled_at IS NULL;

-- A cancelled signup is not attendance. NOT VALID keeps the migration
-- deployable if a historic row ever disagrees, while protecting every write.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'volunteer_signups_cancel_before_attendance'
  ) THEN
    ALTER TABLE public.volunteer_signups
      ADD CONSTRAINT volunteer_signups_cancel_before_attendance
      CHECK (
        cancelled_at IS NULL
        OR (checked_in_at IS NULL AND checked_out_at IS NULL)
      ) NOT VALID;
  END IF;
END;
$$;

-- The volunteer's own signup list is read with explicit column projections by
-- routes that predate cancellation, so a cancelled row would still read as an
-- active registration. Scope the owner's own view to live signups instead;
-- the NGO-side policy that drives attendance lists is left untouched.
DROP POLICY IF EXISTS "Users can view own signups" ON public.volunteer_signups;
CREATE POLICY "Users can view own active signups"
  ON public.volunteer_signups FOR SELECT
  USING (auth.uid() = user_id AND cancelled_at IS NULL);

-- ---------------------------------------------------------------------------
-- Pledge withdrawal.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_pledge_transaction(
  p_actor_id uuid,
  p_pledge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_pledge public.pledges%ROWTYPE;
  v_match public.pledges%ROWTYPE;
  v_need public.needs%ROWTYPE;
  v_released integer;
  v_new_pledged integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_pledge FROM public.pledges WHERE id = p_pledge_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pledge not found' USING ERRCODE = 'P0002';
  END IF;

  -- Ownership is decided here, never from a request body or user metadata.
  IF v_pledge.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_pledge.status = 'cancelled' THEN
    RAISE EXCEPTION 'pledge is already cancelled' USING ERRCODE = '23514';
  END IF;
  -- delivered/confirmed are evidence of a real handover.
  IF v_pledge.status <> 'pledged' THEN
    RAISE EXCEPTION 'delivered or confirmed pledges cannot be cancelled' USING ERRCODE = '23514';
  END IF;
  -- A company match exists only as a consequence of its donor pledge.
  IF v_pledge.match_of_pledge_id IS NOT NULL THEN
    RAISE EXCEPTION 'a company match is cancelled with its donor pledge' USING ERRCODE = '23514';
  END IF;

  -- The match row was reserved against the same need, so release it too.
  SELECT * INTO v_match FROM public.pledges
  WHERE match_of_pledge_id = p_pledge_id AND status = 'pledged'
  FOR UPDATE;

  v_released := coalesce(v_pledge.quantity, 0) + coalesce(v_match.quantity, 0);

  SELECT * INTO v_need FROM public.needs WHERE id = v_pledge.need_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'need not found' USING ERRCODE = 'P0002';
  END IF;

  v_new_pledged := greatest(0, coalesce(v_need.quantity_pledged, 0) - v_released);

  UPDATE public.pledges
  SET status = 'cancelled', cancelled_at = v_now
  WHERE id = p_pledge_id;

  IF v_match.id IS NOT NULL THEN
    UPDATE public.pledges
    SET status = 'cancelled', cancelled_at = v_now
    WHERE id = v_match.id;
  END IF;

  -- Re-derive fulfilment for quantity-tracked needs only; a need without a
  -- target may have been closed by hand and must not be reopened here.
  UPDATE public.needs
  SET quantity_pledged = v_new_pledged,
      is_fulfilled = CASE
        WHEN quantity_needed IS NULL THEN is_fulfilled
        ELSE v_new_pledged >= quantity_needed
      END
  WHERE id = v_need.id;

  -- create_pledge_transaction counts the donor pledge once, match included.
  UPDATE public.profiles
  SET total_pledges = greatest(0, coalesce(total_pledges, 0) - 1)
  WHERE id = v_pledge.user_id;

  IF v_pledge.company_id IS NOT NULL THEN
    PERFORM public.append_audit_log_event(
      p_actor_id, v_pledge.company_id, 'pledge.cancel', 'pledge', p_pledge_id,
      jsonb_build_object(
        'need_id', v_pledge.need_id,
        'quantity', v_pledge.quantity,
        'match_pledge_id', v_match.id,
        'released_quantity', v_released,
        'cancelled_at', v_now
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'pledge_id', p_pledge_id,
    'status', 'cancelled',
    'cancelled_at', v_now,
    'match_pledge_id', v_match.id,
    'released_quantity', v_released,
    'need', jsonb_build_object('id', v_need.id, 'quantity_pledged', v_new_pledged)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_pledge_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pledge_transaction(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Volunteer signup withdrawal (soft, never a DELETE).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_volunteer_signup_transaction(
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
  v_event public.volunteer_events%ROWTYPE;
  v_signed_up integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_signup FROM public.volunteer_signups WHERE id = p_signup_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'signup not found' USING ERRCODE = 'P0002';
  END IF;

  -- Ownership is decided here, never from a request body or user metadata.
  IF v_signup.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_signup.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'signup is already cancelled' USING ERRCODE = '23514';
  END IF;
  -- Attendance has been recorded: the row is evidence from here on.
  IF v_signup.checked_in_at IS NOT NULL OR v_signup.checked_out_at IS NOT NULL THEN
    RAISE EXCEPTION 'attendance already recorded' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_event FROM public.volunteer_events WHERE id = v_signup.event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.volunteer_signups SET cancelled_at = v_now WHERE id = p_signup_id;

  UPDATE public.volunteer_events
  SET volunteers_signed_up = greatest(0, coalesce(volunteers_signed_up, 0) - 1)
  WHERE id = v_event.id
  RETURNING volunteers_signed_up INTO v_signed_up;

  IF v_signup.company_id IS NOT NULL THEN
    PERFORM public.append_audit_log_event(
      p_actor_id, v_signup.company_id, 'volunteer.signup_cancel', 'volunteer_signup', p_signup_id,
      jsonb_build_object('event_id', v_event.id, 'cancelled_at', v_now)
    );
  END IF;

  RETURN jsonb_build_object(
    'signup_id', p_signup_id,
    'cancelled_at', v_now,
    'event', jsonb_build_object('id', v_event.id, 'volunteers_signed_up', v_signed_up)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_volunteer_signup_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_volunteer_signup_transaction(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Signup and check-in now have to reason about cancelled rows.
-- ---------------------------------------------------------------------------

-- Capacity and duplicate detection must ignore cancelled rows, and a returning
-- volunteer revives the existing row: unique(user_id, event_id) forbids a
-- second insert and the row id may already be referenced elsewhere.
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
  RETURN to_jsonb(v_signup);
END;
$$;

REVOKE ALL ON FUNCTION public.volunteer_signup_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_signup_transaction(uuid, uuid) TO service_role;

-- A volunteer who withdrew is not on the attendance list. Without this guard
-- the only thing stopping a check-in would be the table constraint, which
-- reports a constraint name instead of a reason.
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
  IF v_signup.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'signup was cancelled' USING ERRCODE = '23514';
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
  IF v_signup.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'signup was cancelled' USING ERRCODE = '23514';
  END IF;
  IF v_signup.checked_out_at IS NOT NULL THEN RAISE EXCEPTION 'session completed' USING ERRCODE = '23514'; END IF;
  IF v_signup.checked_in_at IS NOT NULL THEN RETURN v_signup.checked_in_at; END IF;
  UPDATE public.volunteer_signups SET checked_in_at = v_now WHERE id = v_signup.id;
  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.volunteer_self_checkin_transaction(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_self_checkin_transaction(uuid, uuid, text) TO service_role;

COMMIT;
