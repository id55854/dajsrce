-- "I am this association" becomes a reviewed claim against the official
-- register instead of a free-text assertion.
--
-- Before this migration public.complete_profile_setup let any authenticated
-- account type any organisation name and immediately minted a public
-- institution row for it (source = 'user_claimed') at a fabricated Zagreb
-- coordinate -- 45.8131, 15.9775, address 'Location withheld', city 'Zagreb'.
-- Nothing reviewed it, so anyone could impersonate any charity and publish a
-- coordinate that was never observed anywhere.
--
-- What replaces it:
--   * the applicant selects a UDR_ID from the currently published registry
--     snapshot (public.registry_publication_state -> current_batch_id);
--   * an optional mailbox challenge proves control of the address the official
--     register publishes for that organisation -- digest at rest, one use;
--   * an administrator approves or rejects the claim;
--   * approval builds the institution from register facts only, links the
--     canonical registry row and the published directory projection, and only
--     then grants profiles.role = 'ngo' + profiles.institution_id.
--
-- Apply after 20260812110000_cancel_pledges_and_signups.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Provenance value for an institution created by an approved claim.
--    'user_claimed' recorded an unreviewed assertion; a reviewed claim built
--    from register facts is a different thing and is labelled as such.
-- ---------------------------------------------------------------------------

-- Migration 014 added the CHECK inline, so its name depends on how that
-- deployment resolved the auto-generated identifier. Drop whichever CHECK on
-- this table still enumerates the old value list.
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT c.conname
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'institutions'
      AND c.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%user_claimed%'
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.institutions DROP CONSTRAINT %I', v_name);
  END LOOP;
END;
$$;

ALTER TABLE public.institutions
  ADD CONSTRAINT institutions_source_check
  CHECK (source IN ('curated', 'registry', 'user_claimed', 'registry_claim'));

-- ---------------------------------------------------------------------------
-- 2. The claim itself.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.institution_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  udr_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'email_sent', 'approved', 'rejected', 'withdrawn')),
  contact_email text NOT NULL,
  evidence_note text,
  -- Raw challenge tokens are never persisted. Only the SHA-256 digest is, and
  -- only until the claim leaves the open states.
  email_token_hash text,
  email_token_expires_at timestamptz,
  email_consumed_at timestamptz,
  institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.institution_claims
  DROP CONSTRAINT IF EXISTS institution_claims_token_is_digest;
ALTER TABLE public.institution_claims
  ADD CONSTRAINT institution_claims_token_is_digest
  CHECK (email_token_hash IS NULL OR email_token_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE public.institution_claims
  DROP CONSTRAINT IF EXISTS institution_claims_contact_email_bounded;
ALTER TABLE public.institution_claims
  ADD CONSTRAINT institution_claims_contact_email_bounded
  CHECK (char_length(contact_email) BETWEEN 5 AND 254);

ALTER TABLE public.institution_claims
  DROP CONSTRAINT IF EXISTS institution_claims_note_bounded;
ALTER TABLE public.institution_claims
  ADD CONSTRAINT institution_claims_note_bounded
  CHECK (
    (evidence_note IS NULL OR char_length(evidence_note) <= 2000)
    AND (review_note IS NULL OR char_length(review_note) <= 2000)
  );

-- One open claim per applicant, and one open-or-approved claim per official
-- organisation. Both are enforced by the database, not by a route check.
CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_claims_open_per_profile
  ON public.institution_claims (profile_id)
  WHERE status IN ('pending', 'email_sent');

CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_claims_open_per_udr
  ON public.institution_claims (udr_id)
  WHERE status IN ('pending', 'email_sent', 'approved');

CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_claims_email_token_hash
  ON public.institution_claims (email_token_hash)
  WHERE email_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_institution_claims_review_queue
  ON public.institution_claims (status, created_at DESC, id);

ALTER TABLE public.institution_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.institution_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.institution_claims TO service_role;

-- Column privileges, not a blanket SELECT: the digest, its expiry and the
-- reviewer identity never reach a browser.
GRANT SELECT (
  id, profile_id, udr_id, status, contact_email, evidence_note,
  email_consumed_at, institution_id, reviewed_at, review_note,
  created_at, updated_at
) ON public.institution_claims TO authenticated;

DROP POLICY IF EXISTS "Applicants read own institution claims" ON public.institution_claims;
CREATE POLICY "Applicants read own institution claims"
  ON public.institution_claims FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Bounded picker over the published snapshot.
--
--    search_association_registry_v1 already pages the whole directory, but it
--    cannot answer "may I claim this row?" and it happily returns a page with
--    no query at all. The picker needs a required query, a small cap and the
--    claim state, so it gets its own narrow function rather than widening the
--    public directory contract.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_claimable_associations_v1(
  p_query text,
  p_county text DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
DECLARE
  v_batch_id text;
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_county text := nullif(btrim(coalesce(p_county, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 25));
  v_items jsonb;
BEGIN
  IF v_query IS NULL OR char_length(v_query) < 2 OR char_length(v_query) > 100 THEN
    RAISE EXCEPTION 'search query must contain 2 to 100 characters' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(v_county, '')) > 100 THEN
    RAISE EXCEPTION 'county filter is too long' USING ERRCODE = '22023';
  END IF;

  SELECT state.current_batch_id INTO v_batch_id
  FROM public.registry_publication_state state
  WHERE state.singleton = true;

  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'no registry snapshot is published' USING ERRCODE = 'P0002';
  END IF;

  -- Ordering lives in the bounded subquery, matching the shape the published
  -- directory search already uses.
  SELECT coalesce(jsonb_agg(item), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      jsonb_build_object(
        'id', d.udr_id,
        'name', d.name,
        'short_name', d.short_name,
        'status', d.status,
        'address', d.address,
        'city', d.city,
        'county', d.county,
        'registry_number', d.registry_number,
        'legal_form', d.legal_form,
        'registry_email', d.email,
        'claim_state', CASE
          WHEN d.institution_id IS NOT NULL THEN 'linked'
          WHEN EXISTS (
            SELECT 1 FROM public.institution_claims c
            WHERE c.udr_id = d.udr_id
              AND c.status IN ('pending', 'email_sent', 'approved')
          ) THEN 'claimed'
          ELSE 'available'
        END
      ) AS item
    FROM public.registry_directory_entries d
    WHERE d.batch_id = v_batch_id
      AND d.status = 'AKTIVAN'
      AND d.search_text ILIKE '%' || lower(v_query) || '%'
      AND (v_county IS NULL OR d.county = v_county)
    ORDER BY d.name COLLATE public.hr_sort, d.udr_id
    LIMIT v_limit
  ) page_rows;

  RETURN jsonb_build_object('version', 1, 'items', v_items, 'limit', v_limit);
END;
$$;

-- Reached only through /api/institution-claims/search, which requires a signed
-- in account first. No direct PostgREST path exists for it.
REVOKE ALL ON FUNCTION public.search_claimable_associations_v1(text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_claimable_associations_v1(text, text, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Claim lifecycle. Every one of these authorises from p_actor_id/
--    p_reviewer_id read inside the transaction, never from a request body,
--    user metadata or a feature flag.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_institution_claim_transaction(
  p_actor_id uuid,
  p_udr_id text,
  p_contact_email text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_claim public.institution_claims%ROWTYPE;
  v_batch_id text;
  v_directory public.registry_directory_entries%ROWTYPE;
  v_registry_institution_id uuid;
  v_udr_id text := btrim(coalesce(p_udr_id, ''));
  v_email text := lower(btrim(coalesce(p_contact_email, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_udr_id) < 1 OR char_length(v_udr_id) > 64 THEN
    RAISE EXCEPTION 'invalid registry identifier' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_email) < 5 OR char_length(v_email) > 254
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' THEN
    RAISE EXCEPTION 'contact email is not valid' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'evidence note is too long' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_actor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'actor profile not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_profile.role NOT IN ('individual', 'ngo') THEN
    RAISE EXCEPTION 'this account cannot claim an organisation' USING ERRCODE = '42501';
  END IF;
  IF v_profile.institution_id IS NOT NULL THEN
    RAISE EXCEPTION 'this account is already linked to an organisation' USING ERRCODE = 'P0001';
  END IF;

  SELECT state.current_batch_id INTO v_batch_id
  FROM public.registry_publication_state state
  WHERE state.singleton = true;

  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'no registry snapshot is published' USING ERRCODE = 'P0002';
  END IF;

  -- A claim is only meaningful against the snapshot that is live right now.
  SELECT d.* INTO v_directory
  FROM public.registry_directory_entries d
  WHERE d.batch_id = v_batch_id AND d.udr_id = v_udr_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation is not in the published registry snapshot'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_directory.status IS DISTINCT FROM 'AKTIVAN' THEN
    RAISE EXCEPTION 'organisation is not active in the official register'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_directory.institution_id IS NOT NULL THEN
    RAISE EXCEPTION 'organisation is already linked on the platform' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.institution_id INTO v_registry_institution_id
  FROM public.ngo_registry r
  WHERE r.udr_id = v_udr_id
  FOR UPDATE;

  IF v_registry_institution_id IS NOT NULL THEN
    RAISE EXCEPTION 'organisation is already linked on the platform' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.institution_claims c
    WHERE c.profile_id = p_actor_id AND c.status IN ('pending', 'email_sent')
  ) THEN
    RAISE EXCEPTION 'an open claim already exists for this account' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.institution_claims c
    WHERE c.udr_id = v_udr_id AND c.status IN ('pending', 'email_sent', 'approved')
  ) THEN
    RAISE EXCEPTION 'this organisation already has a claim under review' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.institution_claims (
    profile_id, udr_id, status, contact_email, evidence_note
  ) VALUES (
    p_actor_id, v_udr_id, 'pending', v_email, v_note
  )
  RETURNING * INTO v_claim;

  PERFORM public.append_audit_log_event(
    p_actor_id,
    NULL,
    'institution_claim.request',
    'institution_claim',
    v_claim.id,
    jsonb_build_object(
      'udr_id', v_udr_id,
      'batch_id', v_batch_id,
      'organisation_name', v_directory.name,
      'contact_email', v_email
    )
  );

  RETURN jsonb_build_object(
    'id', v_claim.id,
    'status', v_claim.status,
    'udr_id', v_claim.udr_id,
    'contact_email', v_claim.contact_email,
    'evidence_note', v_claim.evidence_note,
    'created_at', v_claim.created_at,
    'organisation', jsonb_build_object(
      'id', v_directory.udr_id,
      'name', v_directory.name,
      'city', v_directory.city,
      'county', v_directory.county,
      'address', v_directory.address,
      'registry_email', v_directory.email
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_institution_claim_transaction(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_institution_claim_transaction(uuid, text, text, text)
  TO service_role;

-- The mailbox challenge. The caller generates the raw token, mails it and
-- hands this function only the digest -- exactly like company verification.
CREATE OR REPLACE FUNCTION public.start_institution_claim_email_verification(
  p_actor_id uuid,
  p_claim_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.institution_claims%ROWTYPE;
  v_batch_id text;
  v_registry_email text;
  v_now timestamptz := now();
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid verification token' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= v_now OR p_expires_at > v_now + interval '7 days' THEN
    RAISE EXCEPTION 'verification expiry must be within 7 days' USING ERRCODE = '22023';
  END IF;

  SELECT c.* INTO v_claim
  FROM public.institution_claims c
  WHERE c.id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_claim.profile_id <> p_actor_id THEN
    RAISE EXCEPTION 'claim does not belong to this account' USING ERRCODE = '42501';
  END IF;
  IF v_claim.status NOT IN ('pending', 'email_sent') THEN
    RAISE EXCEPTION 'claim is no longer open' USING ERRCODE = 'P0001';
  END IF;

  SELECT state.current_batch_id INTO v_batch_id
  FROM public.registry_publication_state state
  WHERE state.singleton = true;

  SELECT nullif(lower(btrim(coalesce(d.email, ''))), '')
  INTO v_registry_email
  FROM public.registry_directory_entries d
  WHERE d.batch_id = v_batch_id AND d.udr_id = v_claim.udr_id;

  -- A mailbox challenge only proves something when the mailbox is the one the
  -- official register publishes. When the register publishes no address the
  -- challenge is skipped entirely and the claim rests on human review.
  IF v_registry_email IS NULL THEN
    RAISE EXCEPTION 'the official register publishes no email for this organisation'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_registry_email <> lower(btrim(v_claim.contact_email)) THEN
    RAISE EXCEPTION 'contact email does not match the address published by the register'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.institution_claims c
  SET status = 'email_sent',
      email_token_hash = p_token_hash,
      email_token_expires_at = p_expires_at,
      email_consumed_at = NULL,
      updated_at = v_now
  WHERE c.id = v_claim.id
  RETURNING * INTO v_claim;

  PERFORM public.append_audit_log_event(
    p_actor_id,
    NULL,
    'institution_claim.email.start',
    'institution_claim',
    v_claim.id,
    jsonb_build_object('udr_id', v_claim.udr_id, 'expires_at', p_expires_at)
  );

  RETURN jsonb_build_object(
    'id', v_claim.id,
    'status', v_claim.status,
    'email_token_expires_at', v_claim.email_token_expires_at,
    'contact_email', v_claim.contact_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_institution_claim_email_verification(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_institution_claim_email_verification(uuid, uuid, text, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_institution_claim_email(p_token_hash text)
RETURNS TABLE (
  claim_id uuid,
  claim_status text,
  udr_id text,
  organisation_name text,
  confirmed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.institution_claims%ROWTYPE;
  v_batch_id text;
  v_name text;
  v_now timestamptz := now();
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid verification token' USING ERRCODE = '22023';
  END IF;

  SELECT c.* INTO v_claim
  FROM public.institution_claims c
  WHERE c.email_token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification not found' USING ERRCODE = 'P0002';
  END IF;
  -- The digest is kept so a replay reports "already used" rather than
  -- degrading into an indistinguishable "not found".
  IF v_claim.email_consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'verification already used' USING ERRCODE = 'P0001';
  END IF;
  IF v_claim.email_token_expires_at IS NULL OR v_claim.email_token_expires_at <= v_now THEN
    RAISE EXCEPTION 'verification expired' USING ERRCODE = 'P0001';
  END IF;
  IF v_claim.status NOT IN ('pending', 'email_sent') THEN
    RAISE EXCEPTION 'claim is no longer open' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.institution_claims c
  SET email_consumed_at = v_now,
      status = 'email_sent',
      updated_at = v_now
  WHERE c.id = v_claim.id AND c.email_consumed_at IS NULL
  RETURNING * INTO v_claim;

  SELECT state.current_batch_id INTO v_batch_id
  FROM public.registry_publication_state state
  WHERE state.singleton = true;

  SELECT d.name INTO v_name
  FROM public.registry_directory_entries d
  WHERE d.batch_id = v_batch_id AND d.udr_id = v_claim.udr_id;

  PERFORM public.append_audit_log_event(
    v_claim.profile_id,
    NULL,
    'institution_claim.email.confirm',
    'institution_claim',
    v_claim.id,
    jsonb_build_object('udr_id', v_claim.udr_id, 'confirmed_at', v_now)
  );

  RETURN QUERY
  SELECT v_claim.id, v_claim.status, v_claim.udr_id, v_name, v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_institution_claim_email(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_institution_claim_email(text) TO service_role;

CREATE OR REPLACE FUNCTION public.withdraw_institution_claim_transaction(
  p_actor_id uuid,
  p_claim_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.institution_claims%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT c.* INTO v_claim
  FROM public.institution_claims c
  WHERE c.id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_claim.profile_id <> p_actor_id THEN
    RAISE EXCEPTION 'claim does not belong to this account' USING ERRCODE = '42501';
  END IF;
  IF v_claim.status NOT IN ('pending', 'email_sent') THEN
    RAISE EXCEPTION 'claim is no longer open' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.institution_claims c
  SET status = 'withdrawn',
      email_token_hash = NULL,
      email_token_expires_at = NULL,
      updated_at = v_now
  WHERE c.id = v_claim.id
  RETURNING * INTO v_claim;

  PERFORM public.append_audit_log_event(
    p_actor_id,
    NULL,
    'institution_claim.withdraw',
    'institution_claim',
    v_claim.id,
    jsonb_build_object('udr_id', v_claim.udr_id)
  );

  RETURN jsonb_build_object('id', v_claim.id, 'status', v_claim.status);
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_institution_claim_transaction(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_institution_claim_transaction(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reject_institution_claim_transaction(
  p_reviewer_id uuid,
  p_claim_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reviewer_role text;
  v_claim public.institution_claims%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_now timestamptz := now();
BEGIN
  IF p_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'review note is too long' USING ERRCODE = '22023';
  END IF;

  -- Authorisation is read from the database inside the transaction. A route
  -- that forgot its own check cannot make this succeed.
  SELECT p.role INTO v_reviewer_role
  FROM public.profiles p
  WHERE p.id = p_reviewer_id;

  IF v_reviewer_role IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'reviewer is not an administrator' USING ERRCODE = '42501';
  END IF;

  SELECT c.* INTO v_claim
  FROM public.institution_claims c
  WHERE c.id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_claim.status NOT IN ('pending', 'email_sent') THEN
    RAISE EXCEPTION 'claim is no longer open' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.institution_claims c
  SET status = 'rejected',
      reviewed_by = p_reviewer_id,
      reviewed_at = v_now,
      review_note = v_note,
      email_token_hash = NULL,
      email_token_expires_at = NULL,
      updated_at = v_now
  WHERE c.id = v_claim.id
  RETURNING * INTO v_claim;

  PERFORM public.append_audit_log_event(
    p_reviewer_id,
    NULL,
    'institution_claim.reject',
    'institution_claim',
    v_claim.id,
    jsonb_build_object('udr_id', v_claim.udr_id, 'review_note', v_note)
  );

  RETURN jsonb_build_object('id', v_claim.id, 'status', v_claim.status);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_institution_claim_transaction(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_institution_claim_transaction(uuid, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Approval. The institution is built from register facts only; no field
--    comes from the applicant. A coordinate is copied, never invented: an
--    exact DGU address match publishes an exact point, anything else publishes
--    the same coarse, explicitly-approximate point the map already shows for
--    that registry row and marks the location hidden. A register row with no
--    usable point at all is refused rather than parked in central Zagreb.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_institution_claim_transaction(
  p_reviewer_id uuid,
  p_claim_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_reviewer_role text;
  v_claim public.institution_claims%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_registry public.ngo_registry%ROWTYPE;
  v_directory public.registry_directory_entries%ROWTYPE;
  v_institution public.institutions%ROWTYPE;
  v_batch_id text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_now timestamptz := now();
  v_lat double precision;
  v_lng double precision;
  v_hidden boolean;
  v_precision text;
  v_category text;
  v_registry_oib text;
  v_map_lat double precision;
  v_map_lng double precision;
  v_map_precision text;
BEGIN
  IF p_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'review note is too long' USING ERRCODE = '22023';
  END IF;

  SELECT p.role INTO v_reviewer_role
  FROM public.profiles p
  WHERE p.id = p_reviewer_id;

  IF v_reviewer_role IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'reviewer is not an administrator' USING ERRCODE = '42501';
  END IF;

  SELECT c.* INTO v_claim
  FROM public.institution_claims c
  WHERE c.id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_claim.status NOT IN ('pending', 'email_sent') THEN
    RAISE EXCEPTION 'claim is no longer open' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_claim.profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'applicant profile not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_profile.institution_id IS NOT NULL THEN
    RAISE EXCEPTION 'applicant is already linked to an organisation' USING ERRCODE = 'P0001';
  END IF;
  IF v_profile.role NOT IN ('individual', 'ngo') THEN
    RAISE EXCEPTION 'applicant role cannot hold an organisation' USING ERRCODE = '42501';
  END IF;

  SELECT state.current_batch_id INTO v_batch_id
  FROM public.registry_publication_state state
  WHERE state.singleton = true;

  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'no registry snapshot is published' USING ERRCODE = 'P0002';
  END IF;

  -- Re-check membership of the live snapshot: it may have rotated between the
  -- request and the review.
  SELECT d.* INTO v_directory
  FROM public.registry_directory_entries d
  WHERE d.batch_id = v_batch_id AND d.udr_id = v_claim.udr_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation is not in the published registry snapshot'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_directory.status IS DISTINCT FROM 'AKTIVAN' THEN
    RAISE EXCEPTION 'organisation is not active in the official register'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_directory.institution_id IS NOT NULL THEN
    RAISE EXCEPTION 'organisation is already linked on the platform' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.* INTO v_registry
  FROM public.ngo_registry r
  WHERE r.udr_id = v_claim.udr_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation is not in the canonical register' USING ERRCODE = 'P0002';
  END IF;
  IF v_registry.institution_id IS NOT NULL THEN
    RAISE EXCEPTION 'organisation is already linked on the platform' USING ERRCODE = 'P0001';
  END IF;

  -- Coordinate provenance.
  IF v_registry.geocode_source = 'dgu_inspire_addresses'
     AND v_registry.geocode_confidence = 'exact'
     AND v_registry.lat BETWEEN 42 AND 47
     AND v_registry.lng BETWEEN 13 AND 20 THEN
    v_lat := v_registry.lat;
    v_lng := v_registry.lng;
    v_hidden := false;
    v_precision := 'exact';
  ELSIF v_directory.map_lat BETWEEN 42 AND 47 AND v_directory.map_lng BETWEEN 13 AND 20 THEN
    v_lat := v_directory.map_lat;
    v_lng := v_directory.map_lng;
    v_hidden := true;
    v_precision := coalesce(v_directory.map_precision, 'county');
  ELSE
    RAISE EXCEPTION 'the register has no usable location for this organisation'
      USING ERRCODE = 'P0001';
  END IF;

  v_category := coalesce(nullif(btrim(coalesce(v_directory.category, '')), ''), 'association');

  -- registry_oib is uniquely indexed; never let one claim steal another row's.
  v_registry_oib := nullif(btrim(coalesce(v_directory.oib, '')), '');
  IF v_registry_oib IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.institutions i WHERE i.registry_oib = v_registry_oib
  ) THEN
    v_registry_oib := NULL;
  END IF;

  INSERT INTO public.institutions (
    name, category, description, address, city, lat, lng,
    email, website, is_verified, is_location_hidden, approximate_area,
    source, registry_oib, oib, registry_last_verified_at
  ) VALUES (
    v_directory.name,
    v_category,
    left(coalesce(
      nullif(btrim(coalesce(v_registry.opis_djelatnosti, '')), ''),
      nullif(btrim(coalesce(v_registry.ciljevi, '')), ''),
      ''
    ), 2000),
    coalesce(
      nullif(btrim(coalesce(v_directory.address, '')), ''),
      nullif(btrim(coalesce(v_directory.city, '')), ''),
      nullif(btrim(coalesce(v_directory.county, '')), ''),
      ''
    ),
    coalesce(
      nullif(btrim(coalesce(v_directory.city, '')), ''),
      nullif(btrim(coalesce(v_directory.county, '')), ''),
      ''
    ),
    v_lat,
    v_lng,
    nullif(btrim(coalesce(v_directory.email, '')), ''),
    nullif(btrim(coalesce(v_directory.website, '')), ''),
    -- Verified because a human reviewed this claim, not because it was typed.
    true,
    v_hidden,
    nullif(concat_ws(', ',
      nullif(btrim(coalesce(v_directory.city, '')), ''),
      nullif(btrim(coalesce(v_directory.county, '')), '')
    ), ''),
    'registry_claim',
    v_registry_oib,
    CASE WHEN coalesce(v_directory.oib, '') ~ '^[0-9]{11}$' THEN v_directory.oib ELSE NULL END,
    v_directory.last_verified_at
  )
  RETURNING * INTO v_institution;

  -- Link both directions. The public map joins institutions through
  -- registry_directory_entries.institution_id, and the snapshot capture
  -- trigger carries ngo_registry.institution_id into future snapshots;
  -- writing only one of them leaves the pin looking unclaimed.
  UPDATE public.ngo_registry r
  SET institution_id = v_institution.id
  WHERE r.udr_id = v_claim.udr_id;

  SELECT point.latitude, point.longitude, point.location_precision
  INTO v_map_lat, v_map_lng, v_map_precision
  FROM public.registry_public_map_point(
    v_claim.udr_id, v_registry.city, v_registry.zupanija,
    v_registry.lat, v_registry.lng, v_institution.id
  ) point;

  -- A NULL map point would silently drop the organisation off the map. The
  -- institution's own published point is the correct fallback.
  IF v_map_lat IS NULL OR v_map_lng IS NULL THEN
    v_map_lat := v_institution.public_lat;
    v_map_lng := v_institution.public_lng;
    v_map_precision := CASE WHEN v_hidden THEN 'hidden' ELSE 'exact' END;
  END IF;

  UPDATE public.registry_directory_entries d
  SET institution_id = v_institution.id,
      category = v_category,
      map_lat = v_map_lat,
      map_lng = v_map_lng,
      map_precision = v_map_precision,
      map_location = extensions.st_setsrid(
        extensions.st_makepoint(v_map_lng, v_map_lat), 4326
      )::extensions.geography
  WHERE d.batch_id = v_batch_id AND d.udr_id = v_claim.udr_id;

  UPDATE public.profiles p
  SET role = 'ngo', institution_id = v_institution.id
  WHERE p.id = v_claim.profile_id;

  UPDATE public.institution_claims c
  SET status = 'approved',
      institution_id = v_institution.id,
      reviewed_by = p_reviewer_id,
      reviewed_at = v_now,
      review_note = v_note,
      email_token_hash = NULL,
      email_token_expires_at = NULL,
      updated_at = v_now
  WHERE c.id = v_claim.id
  RETURNING * INTO v_claim;

  PERFORM public.append_audit_log_event(
    p_reviewer_id,
    NULL,
    'institution_claim.approve',
    'institution_claim',
    v_claim.id,
    jsonb_build_object(
      'udr_id', v_claim.udr_id,
      'batch_id', v_batch_id,
      'institution_id', v_institution.id,
      'applicant_profile_id', v_claim.profile_id,
      'email_verified', v_claim.email_consumed_at IS NOT NULL,
      'location_precision', v_precision,
      'is_location_hidden', v_hidden,
      'review_note', v_note
    )
  );

  RETURN jsonb_build_object(
    'id', v_claim.id,
    'status', v_claim.status,
    'udr_id', v_claim.udr_id,
    'institution_id', v_institution.id,
    'institution_name', v_institution.name,
    'location_precision', v_precision,
    'is_location_hidden', v_hidden
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_institution_claim_transaction(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_institution_claim_transaction(uuid, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Reads for the two surfaces that need them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_own_institution_claim(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
DECLARE
  v_batch_id text;
  v_claim jsonb;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT state.current_batch_id INTO v_batch_id
  FROM public.registry_publication_state state
  WHERE state.singleton = true;

  SELECT jsonb_build_object(
    'id', c.id,
    'status', c.status,
    'udr_id', c.udr_id,
    'contact_email', c.contact_email,
    'evidence_note', c.evidence_note,
    'email_verified', c.email_consumed_at IS NOT NULL,
    'email_challenge_sent', c.status = 'email_sent' AND c.email_consumed_at IS NULL,
    'review_note', c.review_note,
    'reviewed_at', c.reviewed_at,
    'created_at', c.created_at,
    'organisation', jsonb_build_object(
      'id', c.udr_id,
      'name', d.name,
      'city', d.city,
      'county', d.county,
      'address', d.address,
      'registry_email', d.email
    )
  )
  INTO v_claim
  FROM public.institution_claims c
  LEFT JOIN public.registry_directory_entries d
    ON d.batch_id = v_batch_id AND d.udr_id = c.udr_id
  WHERE c.profile_id = p_actor_id
  ORDER BY
    CASE WHEN c.status IN ('pending', 'email_sent') THEN 0 ELSE 1 END,
    c.created_at DESC
  LIMIT 1;

  RETURN coalesce(v_claim, 'null'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_own_institution_claim(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_own_institution_claim(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.list_institution_claims_for_review(
  p_reviewer_id uuid,
  p_status text DEFAULT 'open',
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
DECLARE
  v_reviewer_role text;
  v_batch_id text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_status text := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'open');
  v_items jsonb;
BEGIN
  IF p_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('open', 'pending', 'email_sent', 'approved', 'rejected', 'withdrawn', 'all') THEN
    RAISE EXCEPTION 'invalid claim status filter' USING ERRCODE = '22023';
  END IF;

  SELECT p.role INTO v_reviewer_role
  FROM public.profiles p
  WHERE p.id = p_reviewer_id;

  IF v_reviewer_role IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'reviewer is not an administrator' USING ERRCODE = '42501';
  END IF;

  SELECT state.current_batch_id INTO v_batch_id
  FROM public.registry_publication_state state
  WHERE state.singleton = true;

  SELECT coalesce(jsonb_agg(item ORDER BY sort_created DESC, sort_id), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      c.created_at AS sort_created,
      c.id AS sort_id,
      jsonb_build_object(
        'id', c.id,
        'status', c.status,
        'udr_id', c.udr_id,
        'contact_email', c.contact_email,
        'evidence_note', c.evidence_note,
        'email_verified', c.email_consumed_at IS NOT NULL,
        'email_challenge_sent', c.email_token_expires_at IS NOT NULL,
        'email_challenge_expires_at', c.email_token_expires_at,
        'created_at', c.created_at,
        'reviewed_at', c.reviewed_at,
        'review_note', c.review_note,
        'applicant', jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'email', p.email,
          'role', p.role
        ),
        'organisation', CASE WHEN d.udr_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', d.udr_id,
          'name', d.name,
          'short_name', d.short_name,
          'status', d.status,
          'address', d.address,
          'city', d.city,
          'county', d.county,
          'registry_number', d.registry_number,
          'legal_form', d.legal_form,
          'registry_email', d.email,
          'website', d.website,
          'already_linked', d.institution_id IS NOT NULL
        ) END
      ) AS item
    FROM public.institution_claims c
    JOIN public.profiles p ON p.id = c.profile_id
    LEFT JOIN public.registry_directory_entries d
      ON d.batch_id = v_batch_id AND d.udr_id = c.udr_id
    WHERE (
      (v_status = 'open' AND c.status IN ('pending', 'email_sent'))
      OR (v_status = 'all')
      OR (c.status = v_status)
    )
    ORDER BY c.created_at DESC, c.id
    LIMIT v_limit
  ) rows_for_review;

  RETURN jsonb_build_object('version', 1, 'items', v_items, 'limit', v_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.list_institution_claims_for_review(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_institution_claims_for_review(uuid, text, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Onboarding no longer creates institutions.
--
--    Same signature so a deployed client keeps working; p_institution_name is
--    retained only for that compatibility and is deliberately ignored. An NGO
--    account is created unlinked and stays unlinked until a claim is approved.
--    Profiles that already carry an institution_id are untouched -- the
--    "onboarding is already complete" guard still refuses to rewrite them.
-- ---------------------------------------------------------------------------

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

    -- No institution row is created here. Publishing an organisation requires
    -- an approved claim against the official register.
    UPDATE public.profiles p
    SET role = 'ngo', institution_id = NULL
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
-- 8. An unlinked NGO cannot publish.
--
--    The 001 policies compared institution_id against a subquery over
--    profiles, which never restricted the role and had no WITH CHECK on
--    update. They are replaced with current_user_institution_id(), which
--    returns a row only for role = 'ngo', plus an explicit NOT NULL guard so a
--    NULL institution_id can never satisfy a policy.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Institution users can create needs" ON public.needs;
CREATE POLICY "Linked NGO creates needs"
  ON public.needs FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_institution_id() IS NOT NULL
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "Institution users can update own needs" ON public.needs;
CREATE POLICY "Linked NGO updates own needs"
  ON public.needs FOR UPDATE TO authenticated
  USING (
    public.current_user_institution_id() IS NOT NULL
    AND institution_id = public.current_user_institution_id()
  )
  WITH CHECK (
    public.current_user_institution_id() IS NOT NULL
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "Institution users can create events" ON public.volunteer_events;
CREATE POLICY "Linked NGO creates volunteer events"
  ON public.volunteer_events FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_institution_id() IS NOT NULL
    AND institution_id = public.current_user_institution_id()
  );

-- These two tables kept Supabase's stock table privileges while every other
-- writable table was locked down. Anonymous callers never post content, and
-- neither table has ever had a DELETE policy.
REVOKE INSERT, UPDATE, DELETE ON public.needs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.volunteer_events FROM anon;
REVOKE DELETE ON public.needs FROM authenticated;
REVOKE DELETE ON public.volunteer_events FROM authenticated;

COMMIT;
