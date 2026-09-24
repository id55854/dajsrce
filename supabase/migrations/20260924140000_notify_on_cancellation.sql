-- Tell the organisation when someone withdraws a pledge or a volunteer signup.
--
-- create_pledge_transaction and volunteer_signup_transaction already notify
-- every `ngo` account linked to the institution; the matching cancel
-- transactions did not, so an organisation only noticed a withdrawal by
-- spotting a missing name. Both functions are re-created from their
-- 20260906120000 bodies unchanged except for the notice (and the name lookup
-- it needs), inserted in the same transaction before the audit event.

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
  v_need public.needs%ROWTYPE;
  v_new_pledged integer;
  v_now timestamptz := clock_timestamp();
  v_donor_name text;
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

  SELECT * INTO v_need FROM public.needs WHERE id = v_pledge.need_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'need not found' USING ERRCODE = 'P0002';
  END IF;

  v_new_pledged := greatest(0, coalesce(v_need.quantity_pledged, 0) - coalesce(v_pledge.quantity, 0));

  UPDATE public.pledges
  SET status = 'cancelled', cancelled_at = v_now
  WHERE id = p_pledge_id;

  -- Re-derive fulfilment for quantity-tracked needs only; a need without a
  -- target may have been closed by hand and must not be reopened here.
  UPDATE public.needs
  SET quantity_pledged = v_new_pledged,
      is_fulfilled = CASE
        WHEN quantity_needed IS NULL THEN is_fulfilled
        ELSE v_new_pledged >= quantity_needed
      END
  WHERE id = v_need.id;

  UPDATE public.profiles
  SET total_pledges = greatest(0, coalesce(total_pledges, 0) - 1)
  WHERE id = v_pledge.user_id;

  -- The organisation hears about a withdrawal the same way it heard about
  -- the pledge: one notice to every account linked to it.
  SELECT name INTO v_donor_name FROM public.profiles WHERE id = v_pledge.user_id;
  INSERT INTO public.notifications (user_id, title, body, link)
  SELECT
    p.id,
    'Obećanje je otkazano',
    format(
      'Korisnik %s otkazao je obećanje za "%s" (količina: %s).',
      coalesce(v_donor_name, 'korisnik'), v_need.title, v_pledge.quantity
    ),
    '/dashboard/institution'
  FROM public.profiles p
  WHERE p.institution_id = v_need.institution_id AND p.role = 'ngo';

  PERFORM public.append_audit_log_event(
    p_actor_id, NULL, 'pledge.cancel', 'pledge', p_pledge_id,
    jsonb_build_object(
      'need_id', v_pledge.need_id,
      'institution_id', v_need.institution_id,
      'released_quantity', v_pledge.quantity,
      'need_quantity_pledged', v_new_pledged,
      'cancelled_at', v_now
    )
  );

  RETURN jsonb_build_object(
    'pledge_id', p_pledge_id,
    'status', 'cancelled',
    'cancelled_at', v_now,
    'match_pledge_id', NULL,
    'released_quantity', v_pledge.quantity,
    'need', jsonb_build_object('id', v_need.id, 'quantity_pledged', v_new_pledged)
  );
END;
$$;

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
  v_volunteer_name text;
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

  -- The organisation hears about a withdrawal the same way it heard about
  -- the signup: one notice to every account linked to it.
  SELECT name INTO v_volunteer_name FROM public.profiles WHERE id = v_signup.user_id;
  INSERT INTO public.notifications (user_id, title, body, link)
  SELECT
    p.id,
    'Prijava je otkazana',
    format(
      'Korisnik %s otkazao je prijavu za "%s" (%s).',
      coalesce(v_volunteer_name, 'korisnik'),
      v_event.title,
      to_char(v_event.event_date::timestamp, 'DD.MM.YYYY.')
    ),
    '/dashboard/institution?view=volunteers'
  FROM public.profiles p
  WHERE p.institution_id = v_event.institution_id AND p.role = 'ngo';

  PERFORM public.append_audit_log_event(
    p_actor_id, NULL, 'volunteer.signup_cancel', 'volunteer_signup', p_signup_id,
    jsonb_build_object(
      'event_id', v_event.id,
      'institution_id', v_event.institution_id,
      'cancelled_at', v_now,
      'volunteers_signed_up', v_signed_up
    )
  );

  RETURN jsonb_build_object(
    'signup_id', p_signup_id,
    'cancelled_at', v_now,
    'event', jsonb_build_object('id', v_event.id, 'volunteers_signed_up', v_signed_up)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_pledge_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pledge_transaction(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_volunteer_signup_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_volunteer_signup_transaction(uuid, uuid) TO service_role;
