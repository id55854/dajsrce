-- An organisation can delete its own needs and volunteer events.
--
-- `pledges.need_id` and `volunteer_signups.event_id` are ON DELETE CASCADE
-- (001), so deleting the parent removes every pledge or signup under it. That
-- is a multi-row change touching other people's records, so it runs here as
-- one service-only transaction (invariant 4) rather than a DELETE from the
-- route:
--
--   * ownership is decided in the database from the actor's profile: an `ngo`
--     whose approved institution owns the row; never from the request body;
--   * everyone with a standing pledge or signup is notified that it is gone,
--     before the cascade removes the rows the notice is built from;
--   * the deletion is audited with the counts it removed.
--
-- `authenticated` keeps no DELETE grant on either table (security release
-- gate), and these functions are service_role only. Neon's default privileges
-- grant EXECUTE on new functions to the API roles, hence the explicit revoke.

CREATE OR REPLACE FUNCTION public.delete_need_transaction(
  p_actor_id uuid,
  p_need_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_need public.needs%ROWTYPE;
  v_actor public.profiles%ROWTYPE;
  v_pledges integer;
  v_notified integer;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_need FROM public.needs WHERE id = p_need_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'need not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_actor.role IS DISTINCT FROM 'ngo'
     OR v_actor.institution_id IS NULL
     OR v_actor.institution_id IS DISTINCT FROM v_need.institution_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_pledges
  FROM public.pledges
  WHERE need_id = p_need_id AND status IS DISTINCT FROM 'cancelled';

  INSERT INTO public.notifications (user_id, title, body, link)
  SELECT DISTINCT p.user_id,
    'Potreba je uklonjena',
    format('Udruga je uklonila potrebu "%s", pa je i vaše obećanje uklonjeno.', v_need.title),
    '/doniraj'
  FROM public.pledges p
  WHERE p.need_id = p_need_id AND p.status IS DISTINCT FROM 'cancelled';
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  DELETE FROM public.needs WHERE id = p_need_id;

  PERFORM public.append_audit_log_event(
    p_actor_id, NULL, 'need.delete', 'need', p_need_id,
    jsonb_build_object(
      'institution_id', v_need.institution_id,
      'title', v_need.title,
      'pledges_removed', v_pledges,
      'donors_notified', v_notified
    )
  );

  RETURN jsonb_build_object('need_id', p_need_id, 'pledges_removed', v_pledges);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_volunteer_event_transaction(
  p_actor_id uuid,
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.volunteer_events%ROWTYPE;
  v_actor public.profiles%ROWTYPE;
  v_signups integer;
  v_notified integer;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_event FROM public.volunteer_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_actor.role IS DISTINCT FROM 'ngo'
     OR v_actor.institution_id IS NULL
     OR v_actor.institution_id IS DISTINCT FROM v_event.institution_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_signups
  FROM public.volunteer_signups
  WHERE event_id = p_event_id AND cancelled_at IS NULL;

  INSERT INTO public.notifications (user_id, title, body, link)
  SELECT DISTINCT s.user_id,
    'Volonterski događaj je otkazan',
    format(
      'Udruga je otkazala događaj "%s" (%s), pa je i vaša prijava uklonjena.',
      v_event.title,
      to_char(v_event.event_date::timestamp, 'DD.MM.YYYY.')
    ),
    '/volunteer'
  FROM public.volunteer_signups s
  WHERE s.event_id = p_event_id AND s.cancelled_at IS NULL;
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  DELETE FROM public.volunteer_events WHERE id = p_event_id;

  PERFORM public.append_audit_log_event(
    p_actor_id, NULL, 'volunteer_event.delete', 'volunteer_event', p_event_id,
    jsonb_build_object(
      'institution_id', v_event.institution_id,
      'title', v_event.title,
      'event_date', v_event.event_date,
      'signups_removed', v_signups,
      'volunteers_notified', v_notified
    )
  );

  RETURN jsonb_build_object('event_id', p_event_id, 'signups_removed', v_signups);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_need_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_need_transaction(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.delete_volunteer_event_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_volunteer_event_transaction(uuid, uuid) TO service_role;
