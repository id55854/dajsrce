-- Remove the company/CSR tenant domain entirely.
--
-- Product decision: DajSrce no longer offers a "company" account type.
-- Individual and NGO remain the only two account types. This migration is
-- destructive and irreversible — it drops the company tenant tables, every
-- company-only RPC and RLS policy, the company-only columns on shared
-- tables, and the company-only storage buckets. Only test/seed company
-- data existed at the time this was written; if that has changed, take a
-- fresh backup before running this against production.
--
-- Order matters:
--   1. Reassign any profiles.role = 'company' rows before tightening the
--      role CHECK constraint.
--   2. Drop/rewrite the three RLS policies on tables that are NOT being
--      dropped (pledges, pledge_acknowledgements, volunteer_hours) before
--      touching the columns or functions they reference — a policy is a
--      hard dependency in Postgres, unlike a plain reference inside a
--      plpgsql function body.
--   3. Redefine the shared plpgsql transaction RPCs to drop their company
--      branches. create_pledge_transaction's parameter list shrinks, so it
--      needs DROP FUNCTION + CREATE FUNCTION rather than CREATE OR REPLACE.
--   4. Drop the company-only columns from tables that persist.
--   5. Drop the company-only tables, children first.
--   6. Drop the company-only helper/RPC functions.
--   7. Drop the dead profiles columns and tighten profiles_role_check.
--   8. Drop the company-only storage buckets and their objects.
--
-- append_audit_log_event keeps its p_company_id parameter: every call site
-- that fed it a company id is removed below, so it is simply never invoked
-- with a non-null company id again. Recreating it with a narrower signature
-- would be a cosmetic change with no safety benefit, so it is left as-is.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Reassign any existing company-role profiles before the CHECK tightens.
-- ---------------------------------------------------------------------------

UPDATE public.profiles SET role = 'individual' WHERE role = 'company';

-- ---------------------------------------------------------------------------
-- 2. Drop/rewrite policies on persisting tables that reference company.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Company members view company pledges" ON public.pledges;

DROP POLICY IF EXISTS "Ack read donor or company" ON public.pledge_acknowledgements;
CREATE POLICY "Ack read donor"
  ON public.pledge_acknowledgements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pledges p
      WHERE p.id = pledge_acknowledgements.pledge_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Volunteer hours read company member" ON public.volunteer_hours;

-- ---------------------------------------------------------------------------
-- 3. Redefine shared transaction RPCs without their company branches.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_pledge_transaction(uuid, uuid, integer, text, uuid, uuid, boolean, text, numeric);

CREATE FUNCTION public.create_pledge_transaction(
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

  RETURN jsonb_build_object(
    'pledge', to_jsonb(v_pledge),
    'match_pledge_id', NULL,
    'need', jsonb_build_object('id', p_need_id, 'quantity_pledged', v_new_pledged)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_pledge_transaction(uuid, uuid, integer, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pledge_transaction(uuid, uuid, integer, text, text, numeric) TO service_role;

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
  RETURN v_now;
END;
$$;

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
  RETURN to_jsonb(v_ack);
END;
$$;

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

  RETURN jsonb_build_object(
    'signup_id', p_signup_id,
    'cancelled_at', v_now,
    'event', jsonb_build_object('id', v_event.id, 'volunteers_signed_up', v_signed_up)
  );
END;
$$;

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
  RETURN jsonb_build_object('checked_out_at', v_now, 'hours', v_hours, 'already', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Drop company-only columns from tables that persist.
-- ---------------------------------------------------------------------------

ALTER TABLE public.pledges
  DROP COLUMN IF EXISTS company_id,
  DROP COLUMN IF EXISTS campaign_id,
  DROP COLUMN IF EXISTS match_of_pledge_id;

ALTER TABLE public.volunteer_signups
  DROP COLUMN IF EXISTS company_id;

ALTER TABLE public.volunteer_hours
  DROP COLUMN IF EXISTS company_id;

-- audit_log.company_id is left in place, nullable and unused: audit_log is
-- append-only and hash-chained, so historic rows are never rewritten.

-- ---------------------------------------------------------------------------
-- 5. Drop company-only tables, children first.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.company_verifications CASCADE;
DROP TABLE IF EXISTS public.company_invites CASCADE;
DROP TABLE IF EXISTS public.company_domains CASCADE;
DROP TABLE IF EXISTS public.donation_receipts CASCADE;
DROP TABLE IF EXISTS public.esg_exports CASCADE;
DROP TABLE IF EXISTS public.company_csr_reports CASCADE;
DROP TABLE IF EXISTS public.artifact_version_counters CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.stripe_events CASCADE;
DROP TABLE IF EXISTS public.campaigns CASCADE;
DROP TABLE IF EXISTS public.company_actions CASCADE;
DROP TABLE IF EXISTS public.company_members CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;

-- ---------------------------------------------------------------------------
-- 6. Drop company-only helper/RPC functions.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.current_user_company_member(uuid);
DROP FUNCTION IF EXISTS public.current_user_company_staff(uuid);
DROP FUNCTION IF EXISTS public.current_user_company_finance_access(uuid);
DROP FUNCTION IF EXISTS public.get_public_company_bundle(text);
DROP FUNCTION IF EXISTS public.create_company_tenant_transaction(uuid, jsonb);
DROP FUNCTION IF EXISTS public.accept_company_invite(text);
DROP FUNCTION IF EXISTS public.confirm_company_verification(text);
DROP FUNCTION IF EXISTS public.get_acknowledged_pledges_json(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.get_volunteer_hours_json(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.reserve_artifact_version(uuid, text, text);
DROP FUNCTION IF EXISTS public.claim_stripe_event(text, text, jsonb);
DROP FUNCTION IF EXISTS public.complete_stripe_event(text, boolean, text);

-- ---------------------------------------------------------------------------
-- 7. Drop dead profiles columns and tighten the role CHECK.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS company_name,
  DROP COLUMN IF EXISTS organization_verified;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('individual', 'ngo', 'superadmin'));

-- ---------------------------------------------------------------------------
-- 8. Drop company-only storage buckets and their objects.
-- ---------------------------------------------------------------------------

DELETE FROM storage.objects WHERE bucket_id IN ('receipts', 'exports', 'reports');
DELETE FROM storage.buckets WHERE id IN ('receipts', 'exports', 'reports');

COMMIT;
