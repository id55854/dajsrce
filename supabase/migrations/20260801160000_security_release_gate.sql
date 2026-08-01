-- P0 security release gate.
--
-- This migration removes client-side authority over roles, tenant membership,
-- billing/verification fields and one-time bearer secrets. It also prevents
-- direct reads of exact coordinates for hidden institutions. Apply after
-- 20260801150000_location_fast_path.sql.

BEGIN;

-- Prevent object-shadowing attacks against SECURITY DEFINER functions whose
-- search paths include public. Application roles need USAGE, not CREATE.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Profiles and NGO onboarding: raw auth metadata is not authorization.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Every account starts with the least-privileged role. Company/NGO access is
  -- established later by controlled functions, never user_metadata.
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    coalesce(NEW.email, ''),
    coalesce(nullif(NEW.raw_user_meta_data->>'name', ''), split_part(coalesce(NEW.email, ''), '@', 1), 'User'),
    'individual'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- RLS decides which row; column privileges decide which attributes. Role,
-- institution ownership, counters, badges and verification flags are omitted.
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (name, neighborhood, interests, locale, contact_person, lat, lng)
  ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "Institution reads signup volunteer profiles" ON public.profiles;

DROP POLICY IF EXISTS "NGO without institution may create institution" ON public.institutions;
REVOKE INSERT, UPDATE, DELETE ON public.institutions FROM anon, authenticated;
GRANT UPDATE (
  name, category, description, phone, email, website, working_hours,
  drop_off_hours, accepts_donations, capacity, served_population, photo_url,
  approximate_area, nearest_zet_stop, zet_lines
) ON public.institutions TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_profile_setup(
  p_role text,
  p_institution_name text DEFAULT NULL
)
RETURNS TABLE (profile_role text, profile_institution_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_institution_id uuid;
  v_name text := btrim(coalesce(p_institution_name, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('individual', 'ngo') THEN
    RAISE EXCEPTION 'invalid onboarding role' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_role = 'individual' THEN
    -- Never use onboarding to demote or rewrite an established privileged role.
    IF v_profile.role = 'individual' THEN
      UPDATE public.profiles p SET role = 'individual' WHERE p.id = v_uid;
    END IF;
  ELSE
    IF v_profile.role NOT IN ('individual', 'ngo') OR v_profile.institution_id IS NOT NULL THEN
      RAISE EXCEPTION 'profile onboarding is already complete' USING ERRCODE = 'P0001';
    END IF;
    IF char_length(v_name) < 2 OR char_length(v_name) > 160 THEN
      RAISE EXCEPTION 'institution name must contain 2 to 160 characters' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.institutions (
      name, category, description, address, city, lat, lng,
      served_population, is_verified, is_location_hidden, approximate_area, source
    ) VALUES (
      v_name, 'social_welfare', NULL, 'Location withheld', 'Zagreb',
      45.8131, 15.9775, 'General', false, true, 'Zagreb', 'user_claimed'
    )
    RETURNING id INTO v_institution_id;

    UPDATE public.profiles p
    SET role = 'ngo', institution_id = v_institution_id
    WHERE p.id = v_uid;
  END IF;

  RETURN QUERY
  SELECT p.role, p.institution_id FROM public.profiles p WHERE p.id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_profile_setup(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_profile_setup(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Public institution reads: expose public coordinates, never exact hidden
--    coordinates or hidden street addresses through direct PostgREST access.
-- ---------------------------------------------------------------------------

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS public_address text
    GENERATED ALWAYS AS (
      CASE
        WHEN coalesce(is_location_hidden, false)
          THEN coalesce(nullif(approximate_area, ''), city)
        ELSE address
      END
    ) STORED;

REVOKE SELECT ON public.institutions FROM anon, authenticated;
GRANT SELECT (
  id, name, category, description, city, phone, email, website, working_hours,
  drop_off_hours, accepts_donations, capacity, served_population, photo_url,
  is_verified, is_location_hidden, approximate_area, nearest_zet_stop, zet_lines,
  created_at, updated_at, source, public_lat, public_lng, public_address
) ON public.institutions TO anon, authenticated;

DROP POLICY IF EXISTS "Registry is publicly readable" ON public.ngo_registry;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.ngo_registry FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tenant boundaries: all membership/protected company mutations go through
--    authenticated APIs using the service role after explicit authorization.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Authenticated users can create companies" ON public.companies;
DROP POLICY IF EXISTS "Owner or admin updates company" ON public.companies;
REVOKE INSERT, UPDATE, DELETE ON public.companies FROM anon, authenticated;

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS claimed_oib char(11);
UPDATE public.companies
SET claimed_oib = oib, oib = NULL
WHERE verified_at IS NULL AND oib IS NOT NULL AND claimed_oib IS NULL;

DROP POLICY IF EXISTS "Owner creates initial member" ON public.company_members;
DROP POLICY IF EXISTS "Owner or admin removes members" ON public.company_members;
REVOKE INSERT, UPDATE, DELETE ON public.company_members FROM anon, authenticated;

-- DNS verification must be performed by the server; otherwise staff could
-- stamp verified_at directly and then use that domain as an identity channel.
REVOKE INSERT, UPDATE, DELETE ON public.company_domains FROM anon, authenticated;

-- Legacy company_actions were self-attested as "confirmed" without NGO
-- acknowledgement. Preserve read-only history but stop minting new evidence.
DROP POLICY IF EXISTS "Company users can insert own actions" ON public.company_actions;
REVOKE INSERT, UPDATE, DELETE ON public.company_actions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_company_tenant_transaction(
  p_actor_id uuid,
  p_company jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company public.companies%ROWTYPE;
  v_legal_name text := btrim(coalesce(p_company->>'legal_name', ''));
  v_slug text := btrim(coalesce(p_company->>'slug', ''));
  v_ratio numeric := coalesce(nullif(p_company->>'default_match_ratio', '')::numeric, 0);
  v_revenue numeric := nullif(p_company->>'prior_year_revenue_eur', '')::numeric;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_actor_id) THEN
    RAISE EXCEPTION 'actor profile not found' USING ERRCODE = 'P0002';
  END IF;
  IF char_length(v_legal_name) < 2 OR char_length(v_legal_name) > 240 THEN
    RAISE EXCEPTION 'invalid legal name' USING ERRCODE = '22023';
  END IF;
  IF v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' OR char_length(v_slug) > 64 THEN
    RAISE EXCEPTION 'invalid company slug' USING ERRCODE = '22023';
  END IF;
  IF v_ratio < 0 OR v_ratio > 1 THEN
    RAISE EXCEPTION 'default match ratio must be between 0 and 1' USING ERRCODE = '22023';
  END IF;
  IF v_revenue IS NOT NULL AND v_revenue < 0 THEN
    RAISE EXCEPTION 'prior-year revenue cannot be negative' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.companies (
    owner_id, legal_name, display_name, slug, claimed_oib, address, city, country,
    logo_url, brand_primary_hex, brand_secondary_hex, size_class, csrd_wave,
    prior_year_revenue_eur, default_match_ratio
  ) VALUES (
    p_actor_id,
    v_legal_name,
    nullif(btrim(p_company->>'display_name'), ''),
    v_slug,
    nullif(btrim(p_company->>'oib'), ''),
    nullif(btrim(p_company->>'address'), ''),
    nullif(btrim(p_company->>'city'), ''),
    upper(coalesce(nullif(btrim(p_company->>'country'), ''), 'HR')),
    nullif(btrim(p_company->>'logo_url'), ''),
    nullif(btrim(p_company->>'brand_primary_hex'), ''),
    nullif(btrim(p_company->>'brand_secondary_hex'), ''),
    nullif(p_company->>'size_class', ''),
    nullif(p_company->>'csrd_wave', '')::int,
    v_revenue,
    v_ratio
  )
  RETURNING * INTO v_company;

  INSERT INTO public.company_members (company_id, profile_id, role)
  VALUES (v_company.id, p_actor_id, 'owner');

  UPDATE public.profiles p
  SET role = 'company'
  WHERE p.id = p_actor_id AND p.role = 'individual';

  PERFORM public.append_audit_log_event(
    p_actor_id,
    v_company.id,
    'company.create',
    'company',
    v_company.id,
    jsonb_build_object(
      'legal_name', v_company.legal_name,
      'claimed_oib', v_company.claimed_oib,
      'slug', v_company.slug
    )
  );

  RETURN to_jsonb(v_company);
END;
$$;

REVOKE ALL ON FUNCTION public.create_company_tenant_transaction(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_tenant_transaction(uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. One-time invite tokens: digest at rest, bind acceptance to the signed-in
--    and email-confirmed auth identity, and consume membership atomically.
-- ---------------------------------------------------------------------------

ALTER TABLE public.company_invites
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.company_invites
SET token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
WHERE token_hash IS NULL AND token IS NOT NULL;

ALTER TABLE public.company_invites ALTER COLUMN token_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS company_invites_token_hash_key
  ON public.company_invites(token_hash);

-- Erase historical plaintext and make old deployments fail safely on insert.
ALTER TABLE public.company_invites ALTER COLUMN token DROP NOT NULL;
UPDATE public.company_invites SET token = NULL WHERE token IS NOT NULL;
ALTER TABLE public.company_invites
  DROP CONSTRAINT IF EXISTS company_invites_plaintext_token_empty;
ALTER TABLE public.company_invites
  ADD CONSTRAINT company_invites_plaintext_token_empty CHECK (token IS NULL);

DROP POLICY IF EXISTS "Company staff reads invites" ON public.company_invites;
DROP POLICY IF EXISTS "Company staff creates invites" ON public.company_invites;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.company_invites FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_company_invite(p_token_hash text)
RETURNS TABLE (
  invite_id uuid,
  company_id uuid,
  member_role text,
  invited_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_auth_email text;
  v_email_confirmed_at timestamptz;
  v_invite public.company_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid invite token' USING ERRCODE = '22023';
  END IF;

  SELECT lower(u.email), u.email_confirmed_at
  INTO v_auth_email, v_email_confirmed_at
  FROM auth.users u
  WHERE u.id = v_uid;

  IF v_auth_email IS NULL OR v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'a verified account email is required' USING ERRCODE = '42501';
  END IF;

  SELECT ci.* INTO v_invite
  FROM public.company_invites ci
  WHERE ci.token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite already used' USING ERRCODE = 'P0001';
  END IF;
  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'invite expired' USING ERRCODE = 'P0001';
  END IF;
  IF lower(v_invite.email) <> v_auth_email THEN
    RAISE EXCEPTION 'invite email does not match signed-in account' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.company_members (company_id, profile_id, role)
  VALUES (v_invite.company_id, v_uid, v_invite.role)
  ON CONFLICT (company_id, profile_id) DO NOTHING;

  UPDATE public.profiles p
  SET role = 'company'
  WHERE p.id = v_uid AND p.role = 'individual';

  UPDATE public.company_invites ci
  SET accepted_at = now(), accepted_by = v_uid
  WHERE ci.id = v_invite.id AND ci.accepted_at IS NULL;

  PERFORM public.append_audit_log_event(
    v_uid,
    v_invite.company_id,
    'company.invite.accept',
    'company_invite',
    v_invite.id,
    jsonb_build_object('email', v_invite.email, 'role', v_invite.role)
  );

  RETURN QUERY SELECT v_invite.id, v_invite.company_id, v_invite.role, v_invite.email;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_company_invite(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_company_invite(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Company verification: digest at rest and one atomic, explicit POST-only
--    confirmation. Direct table reads are blocked to keep token/IP state private.
-- ---------------------------------------------------------------------------

ALTER TABLE public.company_verifications
  ADD COLUMN IF NOT EXISTS token_hash text;

UPDATE public.company_verifications
SET token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
WHERE token_hash IS NULL AND token IS NOT NULL;

ALTER TABLE public.company_verifications ALTER COLUMN token_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS company_verifications_token_hash_key
  ON public.company_verifications(token_hash);

ALTER TABLE public.company_verifications ALTER COLUMN token DROP NOT NULL;
UPDATE public.company_verifications SET token = NULL, confirmed_ip = NULL;
ALTER TABLE public.company_verifications
  DROP CONSTRAINT IF EXISTS company_verifications_plaintext_token_empty;
ALTER TABLE public.company_verifications
  ADD CONSTRAINT company_verifications_plaintext_token_empty CHECK (token IS NULL);

DROP POLICY IF EXISTS "Members read own company verifications" ON public.company_verifications;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.company_verifications FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.confirm_company_verification(p_token_hash text)
RETURNS TABLE (
  verification_id uuid,
  company_id uuid,
  company_slug text,
  company_name text,
  confirmed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_verification public.company_verifications%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid verification token' USING ERRCODE = '22023';
  END IF;

  SELECT cv.* INTO v_verification
  FROM public.company_verifications cv
  WHERE cv.token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_verification.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'verification already used' USING ERRCODE = 'P0001';
  END IF;
  IF v_verification.expires_at <= v_now THEN
    RAISE EXCEPTION 'verification expired' USING ERRCODE = 'P0001';
  END IF;
  IF v_verification.sudreg_status IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'company is not active in the court registry' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.company_verifications cv
  SET confirmed_at = v_now
  WHERE cv.id = v_verification.id AND cv.confirmed_at IS NULL;

  UPDATE public.companies c
  SET verified_at = v_now,
      oib = v_verification.sudreg_oib,
      claimed_oib = NULL,
      legal_name = v_verification.sudreg_legal_name,
      address = coalesce(v_verification.sudreg_address, c.address),
      city = coalesce(v_verification.sudreg_city, c.city),
      updated_at = v_now
  WHERE c.id = v_verification.company_id
  RETURNING c.* INTO v_company;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'company not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.append_audit_log_event(
    NULL,
    v_company.id,
    'company.verification.confirm',
    'company_verification',
    v_verification.id,
    jsonb_build_object(
      'confirmed_at', v_now,
      'sudreg_oib', v_verification.sudreg_oib
    )
  );

  RETURN QUERY
  SELECT
    v_verification.id,
    v_company.id,
    v_company.slug,
    coalesce(v_company.display_name, v_company.legal_name),
    v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_company_verification(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_company_verification(text) TO service_role;

-- The scheduled sweep is a single bounded database transaction rather than an
-- N+1 sequence of service-role reads and partially applied writes.
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
    RETURNING pledge_id
  ), updated AS (
    UPDATE public.pledges p
    SET status = 'confirmed', fulfilled_at = coalesce(p.fulfilled_at, v_now)
    FROM inserted i
    WHERE p.id = i.pledge_id
    RETURNING p.id
  )
  SELECT count(*)::integer INTO v_inserted FROM updated;

  RETURN jsonb_build_object('processed', v_inserted, 'inserted', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.auto_acknowledge_due_pledges_transaction(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_acknowledge_due_pledges_transaction(integer, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Volunteer signups: users can no longer patch checked_out_at/company_id.
--    Check-in/out mutations are handled by the transactional server workflow.
-- ---------------------------------------------------------------------------

-- Revoke the older permissive mutation paths. Leaving these policies/grants
-- active would let direct PostgREST calls bypass capacity locks, quantity
-- counters, evidence state transitions and audit appends.
DROP POLICY IF EXISTS "Users can create pledges" ON public.pledges;
REVOKE INSERT, UPDATE, DELETE ON public.pledges FROM anon, authenticated;

DROP POLICY IF EXISTS "Institution can insert manual ack" ON public.pledge_acknowledgements;
REVOKE INSERT, UPDATE, DELETE ON public.pledge_acknowledgements FROM anon, authenticated;

DROP POLICY IF EXISTS "Users can sign up" ON public.volunteer_signups;
DROP POLICY IF EXISTS "Volunteer self check-in times" ON public.volunteer_signups;
DROP POLICY IF EXISTS "Institution updates check-in on own event signups" ON public.volunteer_signups;
REVOKE INSERT, UPDATE, DELETE ON public.volunteer_signups FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.volunteer_hours FROM anon, authenticated;

-- These operational tables never have a browser mutation path, even on
-- projects whose Supabase default privileges explicitly grant table access.
REVOKE INSERT, UPDATE, DELETE ON public.stripe_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM anon, authenticated;

COMMIT;
