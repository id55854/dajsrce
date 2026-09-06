-- ---------------------------------------------------------------------------
-- 20260906120000_audit_transaction_coverage.sql
--
-- Restore audit-log coverage for every pledge and volunteer state transition.
--
-- The original transactional functions (202608010300_transactional_integrity)
-- appended a hash-chained audit_log event on every mutation. When the company
-- domain was removed (20260823100000_remove_company_domain) the functions were
-- recreated without those calls, and the two later rewrites
-- (20260812110000 for check-in, 20260824100000 for notifications) inherited
-- that omission. Verified against the live catalogue on 2026-09-06: none of
-- the ten transaction functions below referenced append_audit_log_event.
--
-- This migration re-creates each function with its live body unchanged and
-- adds exactly one PERFORM public.append_audit_log_event(...) per completed
-- state change. Idempotent early returns (already checked in, already
-- checked out) record nothing because nothing changed. Payloads carry
-- identifiers, quantities and timestamps only; free-text messages and notes
-- stay out of the audit trail.
--
-- append_audit_log_event keeps its p_company_id parameter for the chain key;
-- every call here passes NULL, i.e. the single global chain.
--
-- Signatures are unchanged, so CREATE OR REPLACE keeps the service_role-only
-- grants. They are restated explicitly below anyway (invariant 11).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- pledge.create
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

  PERFORM public.append_audit_log_event(
    p_user_id, NULL, 'pledge.create', 'pledge', v_pledge.id,
    jsonb_build_object(
      'need_id', p_need_id,
      'institution_id', v_need.institution_id,
      'quantity', p_quantity,
      'amount_eur', v_pledge.amount_eur,
      'tax_category', p_tax_category,
      'need_quantity_pledged', v_new_pledged
    )
  );

  RETURN jsonb_build_object(
    'pledge', to_jsonb(v_pledge),
    'match_pledge_id', NULL,
    'need', jsonb_build_object('id', v_need.id, 'quantity_pledged', v_new_pledged)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_pledge_transaction(uuid, uuid, integer, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pledge_transaction(uuid, uuid, integer, text, text, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- pledge.deliver
-- ---------------------------------------------------------------------------
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

  PERFORM public.append_audit_log_event(
    p_actor_id, NULL, 'pledge.deliver', 'pledge', p_pledge_id,
    jsonb_build_object(
      'need_id', v_pledge.need_id,
      'institution_id', v_institution_id,
      'delivered_at', v_now,
      'actor_is_donor', v_pledge.user_id = p_actor_id
    )
  );

  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_pledge_delivered_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_pledge_delivered_transaction(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- pledge.acknowledge (manual)
-- ---------------------------------------------------------------------------
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

  PERFORM public.append_audit_log_event(
    p_actor_id, NULL, 'pledge.acknowledge', 'pledge', p_pledge_id,
    jsonb_build_object(
      'acknowledgement_id', v_ack.id,
      'kind', 'manual',
      'need_id', v_pledge.need_id,
      'institution_id', v_need_institution_id,
      'signed_at', v_signed_at,
      'signature_hash', v_hash
    )
  );

  RETURN to_jsonb(v_ack);
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_pledge_transaction(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_pledge_transaction(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- pledge.acknowledge (auto, scheduled) -- one event per pledge confirmed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_acknowledge_due_pledges_transaction(
  p_days integer DEFAULT 14,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_inserted integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_row record;
BEGIN
  IF p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'auto-acknowledgement days must be between 1 and 365' USING ERRCODE = '22023';
  END IF;
  p_limit := greatest(1, least(coalesce(p_limit, 500), 1000));

  WITH candidates AS MATERIALIZED (
    SELECT
      p.id AS pledge_id,
      (
        SELECT pr.id
        FROM public.profiles pr
        WHERE pr.institution_id = n.institution_id AND pr.role = 'ngo'
        ORDER BY pr.created_at, pr.id
        LIMIT 1
      ) AS institution_user_id
    FROM public.pledges p
    JOIN public.needs n ON n.id = p.need_id
    WHERE p.status = 'delivered'
      AND p.delivered_at IS NOT NULL
      AND p.delivered_at < v_now - make_interval(days => p_days)
      AND NOT EXISTS (
        SELECT 1 FROM public.pledge_acknowledgements pa WHERE pa.pledge_id = p.id
      )
    ORDER BY p.delivered_at, p.id
    LIMIT p_limit
    FOR UPDATE OF p SKIP LOCKED
  ), inserted AS (
    INSERT INTO public.pledge_acknowledgements (
      pledge_id, institution_user_id, kind, notes, signature_hash, signed_at
    )
    SELECT
      c.pledge_id,
      c.institution_user_id,
      'auto',
      'Auto-acknowledged after ' || p_days::text || ' days without manual confirmation.',
      encode(
        sha256(convert_to('auto|' || c.pledge_id::text || '|' || v_now::text, 'UTF8')),
        'hex'
      ),
      v_now
    FROM candidates c
    ON CONFLICT (pledge_id) DO NOTHING
    RETURNING pledge_id, institution_user_id, signature_hash
  ), updated AS (
    UPDATE public.pledges p
    SET status = 'confirmed', fulfilled_at = coalesce(p.fulfilled_at, v_now)
    FROM inserted i
    WHERE p.id = i.pledge_id
    RETURNING p.id
  )
  SELECT coalesce(
    jsonb_agg(jsonb_build_object(
      'pledge_id', i.pledge_id,
      'institution_user_id', i.institution_user_id,
      'signature_hash', i.signature_hash
    ) ORDER BY i.pledge_id),
    '[]'::jsonb
  )
  INTO v_rows
  FROM inserted i
  JOIN updated u ON u.id = i.pledge_id;

  v_inserted := jsonb_array_length(v_rows);

  FOR v_row IN
    SELECT * FROM jsonb_to_recordset(v_rows)
      AS r(pledge_id uuid, institution_user_id uuid, signature_hash text)
  LOOP
    PERFORM public.append_audit_log_event(
      v_row.institution_user_id, NULL, 'pledge.acknowledge', 'pledge', v_row.pledge_id,
      jsonb_build_object(
        'kind', 'auto',
        'days', p_days,
        'signed_at', v_now,
        'signature_hash', v_row.signature_hash
      )
    );
  END LOOP;

  RETURN jsonb_build_object('processed', v_inserted, 'inserted', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.auto_acknowledge_due_pledges_transaction(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_acknowledge_due_pledges_transaction(integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- pledge.cancel
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
  v_need public.needs%ROWTYPE;
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

REVOKE ALL ON FUNCTION public.cancel_pledge_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pledge_transaction(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- volunteer.signup
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
  v_reactivated boolean := false;
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
    v_reactivated := true;
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

  PERFORM public.append_audit_log_event(
    p_user_id, NULL, 'volunteer.signup', 'volunteer_signup', v_signup.id,
    jsonb_build_object(
      'event_id', p_event_id,
      'institution_id', v_event.institution_id,
      'reactivated', v_reactivated,
      'volunteers_signed_up', v_count + 1
    )
  );

  RETURN to_jsonb(v_signup);
END;
$$;

REVOKE ALL ON FUNCTION public.volunteer_signup_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_signup_transaction(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- volunteer.signup_cancel
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

REVOKE ALL ON FUNCTION public.cancel_volunteer_signup_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_volunteer_signup_transaction(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- volunteer.checkin (staff)
-- ---------------------------------------------------------------------------
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

  PERFORM public.append_audit_log_event(
    p_actor_id, NULL, 'volunteer.checkin', 'volunteer_signup', p_signup_id,
    jsonb_build_object(
      'method', 'staff',
      'event_id', v_signup.event_id,
      'institution_id', v_event_institution,
      'volunteer_user_id', v_signup.user_id,
      'checked_in_at', v_now
    )
  );

  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.volunteer_staff_checkin_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_staff_checkin_transaction(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- volunteer.checkin (self, hashed QR token)
-- ---------------------------------------------------------------------------
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

  -- The token itself is never persisted; the payload carries its hash only,
  -- which ties this check-in to the specific QR code that was scanned.
  PERFORM public.append_audit_log_event(
    p_user_id, NULL, 'volunteer.checkin', 'volunteer_signup', v_signup.id,
    jsonb_build_object(
      'method', 'self',
      'event_id', p_event_id,
      'token_hash', p_token_hash,
      'checked_in_at', v_now
    )
  );

  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.volunteer_self_checkin_transaction(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_self_checkin_transaction(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- volunteer.checkout
-- ---------------------------------------------------------------------------
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
    volunteer_signup_id, user_id, institution_id, hours, recorded_by, recorded_at
  ) VALUES (
    p_signup_id, v_signup.user_id, v_event_institution, v_hours, p_actor_id, v_now
  );

  PERFORM public.append_audit_log_event(
    p_actor_id, NULL, 'volunteer.checkout', 'volunteer_signup', p_signup_id,
    jsonb_build_object(
      'event_id', v_signup.event_id,
      'institution_id', v_event_institution,
      'volunteer_user_id', v_signup.user_id,
      'checked_in_at', v_signup.checked_in_at,
      'checked_out_at', v_now,
      'hours', v_hours
    )
  );

  RETURN jsonb_build_object('checked_out_at', v_now, 'hours', v_hours, 'already', false);
END;
$$;

REVOKE ALL ON FUNCTION public.volunteer_checkout_transaction(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_checkout_transaction(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- audit_log is read through the service role only. The table has RLS with no
-- policies, so these grants were already inert; removing them makes the
-- intent explicit and survives a future policy being added by mistake.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.audit_log FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Self-check: every transaction function must now reference the audit helper.
-- Fails the migration loudly if a body above lost its PERFORM.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT coalesce(array_agg(p.proname::text ORDER BY p.proname), '{}')
  INTO v_missing
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_pledge_transaction',
      'mark_pledge_delivered_transaction',
      'acknowledge_pledge_transaction',
      'auto_acknowledge_due_pledges_transaction',
      'cancel_pledge_transaction',
      'volunteer_signup_transaction',
      'cancel_volunteer_signup_transaction',
      'volunteer_staff_checkin_transaction',
      'volunteer_self_checkin_transaction',
      'volunteer_checkout_transaction'
    )
    AND pg_get_functiondef(p.oid) NOT ILIKE '%append_audit_log_event%';

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'audit coverage incomplete: %', array_to_string(v_missing, ', ');
  END IF;
END;
$$;
