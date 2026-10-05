-- Organisations outside the associations register can claim their profile.
--
-- Caritas Zagrebačke nadbiskupije could not register (2026-09-30): a claim
-- was a reviewed claim against a Registar udruga UDR_ID only, and Caritas is
-- a legal person of the Catholic Church, recorded in the Church's own
-- register, the non-profit register (RNO) and the social-service providers'
-- register instead. The same held for every Caritas, parish, other religious
-- community's charity, foundation and social-care institution.
--
-- 1. official_organisations mirrors the open official registers that hold
--    such organisations (scripts/sync-official-organisations.mjs):
--    Evidencija pravnih osoba Katoličke Crkve (`epokc:<evidencijski broj>`),
--    Evidencija vjerskih zajednica with its organisational units
--    (`evz:<evidencijski broj>`), Registar zaklada (`zaklade:<registarski
--    broj>`) and the legal persons of MROSP's Registar pružatelja socijalnih
--    usluga that are not associations, companies, crafts, cooperatives or
--    local government (`oib:<OIB>`). One row per organisation, merged on OIB;
--    RNO only contributes the published e-mail and its number. Organisations
--    in Registar udruga are left out: they claim by UDR_ID as before. No
--    person's name, IBAN or natural-person provider is stored.
-- 2. A claim's key (institution_claims.udr_id, now "the register key") is a
--    UDR_ID (digits) or one of those prefixed keys. Every claim RPC resolves
--    either; the associations path is unchanged and the new path lives in
--    request_/approve_organisation_claim_transaction.
-- 3. The mailbox challenge goes to the address an official register
--    publishes (RNO, then MROSP, then Registar zaklada), never a typed one;
--    without one the reviewer records an out-of-band check, as before.
-- 4. Approval follows the same steps as for an association (mailbox or a
--    recorded check, a social category chosen by the reviewer) and creates
--    an `organisation_claim` institution, or takes back the organisation's
--    own earlier one whose account is gone. The map lists
--    `organisation_claim` institutions like curated ones: neither has a
--    register row that would put it there.
-- 5. The mirror stays off the map, except Caritas: every active Caritas of
--    the Church or religious-community register whose seat has a DGU
--    building gets an unverified `official_register` institution there
--    (refresh_official_organisation_map_points, run after every sync and
--    geocode import), unless a curated institution already sits at that
--    seat. Its approved claim takes that institution over.
--
-- Signatures are unchanged. The request and approval bodies for
-- associations and the map body are the live ones (20260926110000,
-- 20260927110000, 20260926130000) with only the dispatch and the map's
-- source predicate changed.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Provenance value for institutions claimed from the other registers.
-- ---------------------------------------------------------------------------

ALTER TABLE public.institutions DROP CONSTRAINT IF EXISTS institutions_source_check;
ALTER TABLE public.institutions
  ADD CONSTRAINT institutions_source_check
  CHECK (source IN (
    'curated', 'registry', 'user_claimed', 'registry_claim', 'organisation_claim', 'official_register'
  ));

-- ---------------------------------------------------------------------------
-- 2. The mirror.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.official_organisation_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  sources jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(sources) = 'object'),
  rows_seen integer CHECK (rows_seen IS NULL OR rows_seen >= 0),
  rows_deactivated integer CHECK (rows_deactivated IS NULL OR rows_deactivated >= 0)
);

CREATE TABLE IF NOT EXISTS public.official_organisations (
  id text PRIMARY KEY,
  oib text,
  name text NOT NULL,
  short_name text,
  legal_form text NOT NULL,
  primary_register text NOT NULL,
  register_number text NOT NULL,
  status text NOT NULL,
  registered_on date,
  address text,
  city text,
  county text,
  postcode text,
  email text,
  email_source text,
  website text,
  phone text,
  social_provider boolean NOT NULL DEFAULT false,
  -- An objection to a personal address or phone shown as the organisation's
  -- (privacy policy 2.9): the sync then never stores them again.
  contacts_suppressed boolean NOT NULL DEFAULT false,
  registers jsonb NOT NULL DEFAULT '[]'::jsonb,
  search_text text NOT NULL,
  search_fold text GENERATED ALWAYS AS (public.hr_fold(search_text)) STORED,
  lat double precision,
  lng double precision,
  geocode_source text,
  geocode_address_id text,
  institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL,
  last_seen_sync_id uuid REFERENCES public.official_organisation_syncs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT official_organisations_id_format CHECK (
    id ~ '^(epokc|evz|zaklade):[0-9][0-9.]{0,19}$' OR id ~ '^oib:[0-9]{11}$'
  ),
  CONSTRAINT official_organisations_oib_format CHECK (oib IS NULL OR oib ~ '^[0-9]{11}$'),
  CONSTRAINT official_organisations_register CHECK (primary_register IN ('epokc', 'evz', 'zaklade', 'mrosp')),
  CONSTRAINT official_organisations_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT official_organisations_email_source CHECK (
    (email IS NULL AND email_source IS NULL)
    OR (email IS NOT NULL AND email_source IN ('rno', 'mrosp', 'zaklade'))
  ),
  CONSTRAINT official_organisations_registers_array CHECK (jsonb_typeof(registers) = 'array'),
  CONSTRAINT official_organisations_text_lengths CHECK (
    char_length(name) BETWEEN 1 AND 500
    AND (short_name IS NULL OR char_length(short_name) <= 300)
    AND char_length(legal_form) BETWEEN 1 AND 200
    AND char_length(register_number) BETWEEN 1 AND 40
    AND (address IS NULL OR char_length(address) <= 300)
    AND (city IS NULL OR char_length(city) <= 120)
    AND (county IS NULL OR char_length(county) <= 120)
    AND (postcode IS NULL OR char_length(postcode) <= 10)
    AND (email IS NULL OR char_length(email) BETWEEN 5 AND 254)
    AND (website IS NULL OR char_length(website) <= 300)
    AND (phone IS NULL OR char_length(phone) <= 60)
    AND char_length(search_text) <= 2000
  ),
  CONSTRAINT official_organisations_point CHECK (
    (lat IS NULL AND lng IS NULL AND geocode_source IS NULL)
    OR (lat BETWEEN 42 AND 47 AND lng BETWEEN 13 AND 20 AND geocode_source IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_official_organisations_oib
  ON public.official_organisations (oib) WHERE oib IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_official_organisations_institution
  ON public.official_organisations (institution_id) WHERE institution_id IS NOT NULL;

ALTER TABLE public.official_organisation_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_organisations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.official_organisation_syncs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.official_organisations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.official_organisation_syncs TO service_role;
GRANT ALL ON public.official_organisations TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Helpers.
-- ---------------------------------------------------------------------------

-- A claim key naming an official_organisations row rather than a UDR_ID
-- (UDR_IDs are digits only).
CREATE OR REPLACE FUNCTION public.is_official_organisation_key(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT coalesce(p_key ~ '^(epokc|evz|zaklade|oib):', false)
$$;

REVOKE ALL ON FUNCTION public.is_official_organisation_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_official_organisation_key(text) TO service_role;

-- Whether an organisation's claim can go ahead: its linked institution, if
-- any, is not held by an account.
CREATE OR REPLACE FUNCTION public.official_organisation_is_linked(p_institution_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_institution_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.institution_id = p_institution_id)
    OR EXISTS (
      SELECT 1 FROM public.institution_claims c
      WHERE c.institution_id = p_institution_id AND c.status = 'approved'
    )
  )
$$;

REVOKE ALL ON FUNCTION public.official_organisation_is_linked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.official_organisation_is_linked(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4a. Caritas on the map. The rest of the mirror is shown only once claimed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_official_organisation_map_points()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_created integer := 0;
  v_updated integer := 0;
  v_removed integer := 0;
  v_row record;
  v_id uuid;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.official_map_candidates (id text PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE pg_temp.official_map_candidates;

  -- An active Caritas of the Church or religious-community register, on its
  -- DGU building only (never a coarse or fabricated point), whose seat is
  -- not already a curated institution, and which no account holds yet.
  INSERT INTO pg_temp.official_map_candidates (id)
  SELECT o.id
  FROM public.official_organisations o
  WHERE o.status = 'active'
    AND o.primary_register IN ('epokc', 'evz')
    AND public.hr_fold(o.name) ~ '(^| )caritas( |$)'
    AND o.geocode_source = 'dgu_inspire_addresses'
    AND o.address IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.institutions i
      WHERE i.source = 'curated'
        AND i.is_verified = true
        AND public.hr_fold(split_part(i.address, ',', 1)) = public.hr_fold(o.address)
        AND public.hr_fold(coalesce(i.city, '')) = public.hr_fold(coalesce(o.city, ''))
    )
    AND (
      o.institution_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.institutions i
        WHERE i.id = o.institution_id AND i.source = 'official_register'
      )
    );

  -- An unheld register pin whose organisation no longer qualifies goes.
  WITH gone AS (
    DELETE FROM public.institutions i
    WHERE i.source = 'official_register'
      AND NOT public.official_organisation_is_linked(i.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.official_organisations o
        JOIN pg_temp.official_map_candidates c ON c.id = o.id
        WHERE o.institution_id = i.id
      )
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_removed FROM gone;

  UPDATE public.institutions i
  SET name = o.name,
      address = o.address,
      city = coalesce(o.city, ''),
      lat = o.lat,
      lng = o.lng,
      oib = CASE WHEN coalesce(o.oib, '') ~ '^[0-9]{11}$' THEN o.oib ELSE i.oib END,
      updated_at = now()
  FROM public.official_organisations o
  JOIN pg_temp.official_map_candidates c ON c.id = o.id
  WHERE i.id = o.institution_id
    AND i.source = 'official_register'
    AND (i.name, i.address, i.city, i.lat, i.lng)
      IS DISTINCT FROM (o.name, o.address, coalesce(o.city, ''), o.lat, o.lng);
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  FOR v_row IN
    SELECT o.*
    FROM public.official_organisations o
    JOIN pg_temp.official_map_candidates c ON c.id = o.id
    WHERE o.institution_id IS NULL
    ORDER BY o.id
  LOOP
    -- Unverified: the register vouches for the organisation and DGU for the
    -- building, nobody for what it accepts. Contacts come with its claim.
    INSERT INTO public.institutions (
      name, category, description, address, city, lat, lng,
      is_verified, is_location_hidden, source, oib
    ) VALUES (
      v_row.name, 'caritas', '', v_row.address, coalesce(v_row.city, ''), v_row.lat, v_row.lng,
      false, false, 'official_register',
      CASE WHEN coalesce(v_row.oib, '') ~ '^[0-9]{11}$' THEN v_row.oib END
    )
    RETURNING id INTO v_id;
    UPDATE public.official_organisations o
    SET institution_id = v_id, updated_at = now()
    WHERE o.id = v_row.id;
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'updated', v_updated, 'removed', v_removed);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_official_organisation_map_points() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_official_organisation_map_points() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Sync. One run: begin, upsert batches, finish. Finishing deactivates rows
--    the run did not see, and refuses when the run saw under 90% of the rows
--    that were active, so a truncated download cannot empty the mirror.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.begin_official_organisations_sync(p_sources jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_sources IS NULL OR jsonb_typeof(p_sources) <> 'object' THEN
    RAISE EXCEPTION 'sources must be an object' USING ERRCODE = '22023';
  END IF;
  -- A run that died hours ago must not block the next one forever.
  UPDATE public.official_organisation_syncs s
  SET status = 'failed', finished_at = now()
  WHERE s.status = 'running' AND s.started_at < now() - interval '6 hours';
  IF EXISTS (SELECT 1 FROM public.official_organisation_syncs s WHERE s.status = 'running') THEN
    RAISE EXCEPTION 'another organisation sync is running' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.official_organisation_syncs (sources) VALUES (p_sources)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_official_organisations_batch(p_sync_id uuid, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_accepted integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.official_organisation_syncs s
    WHERE s.id = p_sync_id AND s.status = 'running'
  ) THEN
    RAISE EXCEPTION 'organisation sync is not running' USING ERRCODE = 'P0001';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'rows must be an array of at most 1000 organisations' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.official_organisation_rows (
    id text, oib text, name text, short_name text, legal_form text,
    primary_register text, register_number text, status text, registered_on date,
    address text, city text, county text, postcode text,
    email text, email_source text, website text, phone text,
    social_provider boolean, registers jsonb, search_text text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.official_organisation_rows;

  INSERT INTO pg_temp.official_organisation_rows
  SELECT
    btrim(r.id), nullif(btrim(r.oib), ''), btrim(r.name), nullif(btrim(r.short_name), ''),
    btrim(r.legal_form), btrim(r.primary_register), btrim(r.register_number), btrim(r.status),
    r.registered_on,
    nullif(btrim(r.address), ''), nullif(btrim(r.city), ''), nullif(btrim(r.county), ''),
    nullif(btrim(r.postcode), ''),
    nullif(lower(btrim(r.email)), ''), nullif(btrim(r.email_source), ''),
    nullif(btrim(r.website), ''), nullif(btrim(r.phone), ''),
    coalesce(r.social_provider, false), coalesce(r.registers, '[]'::jsonb),
    left(btrim(r.search_text), 2000)
  FROM jsonb_to_recordset(p_rows) AS r(
    id text, oib text, name text, short_name text, legal_form text,
    primary_register text, register_number text, status text, registered_on date,
    address text, city text, county text, postcode text,
    email text, email_source text, website text, phone text,
    social_provider boolean, registers jsonb, search_text text
  );

  IF EXISTS (
    SELECT 1 FROM pg_temp.official_organisation_rows r
    GROUP BY r.id HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.official_organisation_rows r
    WHERE r.oib IS NOT NULL GROUP BY r.oib HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'a batch repeats an organisation' USING ERRCODE = '22023';
  END IF;

  -- Organisations in Registar udruga claim by UDR_ID; never mirror them here.
  DELETE FROM pg_temp.official_organisation_rows r
  WHERE r.oib IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.ngo_registry g
      WHERE g.oib = r.oib AND g.source_present AND g.status = 'AKTIVAN'
    );

  -- An OIB that moved to another key (the organisation changed register)
  -- leaves its old row, which this run will deactivate.
  UPDATE public.official_organisations o
  SET oib = NULL, updated_at = now()
  FROM pg_temp.official_organisation_rows r
  WHERE r.oib IS NOT NULL AND o.oib = r.oib AND o.id <> r.id;

  INSERT INTO public.official_organisations AS o (
    id, oib, name, short_name, legal_form, primary_register, register_number, status,
    registered_on, address, city, county, postcode, email, email_source, website, phone,
    social_provider, registers, search_text, last_seen_sync_id
  )
  SELECT
    r.id, r.oib, r.name, r.short_name, r.legal_form, r.primary_register, r.register_number,
    r.status, r.registered_on, r.address, r.city, r.county, r.postcode,
    r.email, CASE WHEN r.email IS NULL THEN NULL ELSE r.email_source END,
    r.website, r.phone, r.social_provider, r.registers, r.search_text, p_sync_id
  FROM pg_temp.official_organisation_rows r
  ON CONFLICT (id) DO UPDATE
  SET oib = EXCLUDED.oib,
      name = EXCLUDED.name,
      short_name = EXCLUDED.short_name,
      legal_form = EXCLUDED.legal_form,
      primary_register = EXCLUDED.primary_register,
      register_number = EXCLUDED.register_number,
      status = EXCLUDED.status,
      registered_on = EXCLUDED.registered_on,
      address = EXCLUDED.address,
      city = EXCLUDED.city,
      county = EXCLUDED.county,
      postcode = EXCLUDED.postcode,
      email = CASE WHEN o.contacts_suppressed THEN NULL ELSE EXCLUDED.email END,
      email_source = CASE WHEN o.contacts_suppressed THEN NULL ELSE EXCLUDED.email_source END,
      website = EXCLUDED.website,
      phone = CASE WHEN o.contacts_suppressed THEN NULL ELSE EXCLUDED.phone END,
      social_provider = EXCLUDED.social_provider,
      registers = EXCLUDED.registers,
      search_text = EXCLUDED.search_text,
      -- A point belongs to an address: a moved seat is geocoded again.
      lat = CASE WHEN o.address IS NOT DISTINCT FROM EXCLUDED.address
                  AND o.city IS NOT DISTINCT FROM EXCLUDED.city THEN o.lat END,
      lng = CASE WHEN o.address IS NOT DISTINCT FROM EXCLUDED.address
                  AND o.city IS NOT DISTINCT FROM EXCLUDED.city THEN o.lng END,
      geocode_source = CASE WHEN o.address IS NOT DISTINCT FROM EXCLUDED.address
                  AND o.city IS NOT DISTINCT FROM EXCLUDED.city THEN o.geocode_source END,
      geocode_address_id = CASE WHEN o.address IS NOT DISTINCT FROM EXCLUDED.address
                  AND o.city IS NOT DISTINCT FROM EXCLUDED.city THEN o.geocode_address_id END,
      last_seen_sync_id = p_sync_id,
      updated_at = now();

  GET DIAGNOSTICS v_accepted = ROW_COUNT;
  RETURN v_accepted;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_official_organisations_sync(p_sync_id uuid, p_expected_rows integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_seen integer;
  v_active_before integer;
  v_deactivated integer;
BEGIN
  PERFORM 1 FROM public.official_organisation_syncs s
  WHERE s.id = p_sync_id AND s.status = 'running'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation sync is not running' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_seen
  FROM public.official_organisations o
  WHERE o.last_seen_sync_id = p_sync_id;
  IF p_expected_rows IS NULL OR v_seen <> p_expected_rows THEN
    RAISE EXCEPTION 'sync stored % organisations, expected %', v_seen, p_expected_rows
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_active_before
  FROM public.official_organisations o
  WHERE o.status = 'active';
  IF v_seen < floor(v_active_before * 0.9) THEN
    RAISE EXCEPTION 'sync saw % organisations but % are active; refusing to deactivate the rest',
      v_seen, v_active_before USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.official_organisations o
  SET status = 'inactive', updated_at = now()
  WHERE o.status = 'active' AND o.last_seen_sync_id IS DISTINCT FROM p_sync_id;
  GET DIAGNOSTICS v_deactivated = ROW_COUNT;

  UPDATE public.official_organisation_syncs s
  SET status = 'completed', finished_at = now(), rows_seen = v_seen, rows_deactivated = v_deactivated
  WHERE s.id = p_sync_id;

  RETURN jsonb_build_object(
    'rows_seen', v_seen,
    'rows_deactivated', v_deactivated,
    'map', public.refresh_official_organisation_map_points()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_official_organisations_sync(p_sync_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.official_organisation_syncs s
  SET status = 'failed', finished_at = now()
  WHERE s.id = p_sync_id AND s.status = 'running'
$$;

-- DGU building points for organisation seats, from
-- scripts/audit-dgu-address-match.mjs --organisations. Only a row whose
-- address is unchanged since the audit read it takes the point.
CREATE OR REPLACE FUNCTION public.apply_official_organisation_geocodes(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'rows must be an array of at most 1000 points' USING ERRCODE = '22023';
  END IF;
  UPDATE public.official_organisations o
  SET lat = r.latitude,
      lng = r.longitude,
      geocode_source = 'dgu_inspire_addresses',
      geocode_address_id = left(r.dgu_address_id, 100),
      updated_at = now()
  FROM jsonb_to_recordset(p_rows) AS r(
    organisation_id text, address text, latitude double precision, longitude double precision,
    dgu_address_id text
  )
  WHERE o.id = r.organisation_id
    AND o.address IS NOT DISTINCT FROM r.address
    AND r.latitude BETWEEN 42 AND 47
    AND r.longitude BETWEEN 13 AND 20
    AND r.dgu_address_id ~ '^KB\.';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  PERFORM public.refresh_official_organisation_map_points();
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_official_organisations_sync(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_official_organisations_batch(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_official_organisations_sync(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_official_organisations_sync(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_official_organisation_geocodes(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_official_organisations_sync(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_official_organisations_batch(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_official_organisations_sync(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_official_organisations_sync(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_official_organisation_geocodes(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Claim search covers both.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_claimable_associations_v1(p_query text, p_county text DEFAULT NULL::text, p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_batch_id text;
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_county text := nullif(btrim(coalesce(p_county, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 25));
  v_folded text;
  v_terms text[];
  v_anchor text;
  v_exact text;
  v_exact_number text;
  v_items jsonb;
  v_rows integer;
BEGIN
  IF v_query IS NULL OR char_length(v_query) < 2 OR char_length(v_query) > 100 THEN
    RAISE EXCEPTION 'search query must contain 2 to 100 characters' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(v_county, '')) > 100 THEN
    RAISE EXCEPTION 'county filter is too long' USING ERRCODE = '22023';
  END IF;

  v_folded := public.hr_fold(v_query);
  SELECT coalesce(array_agg(term), '{}')
  INTO v_terms
  FROM (
    SELECT DISTINCT term
    FROM unnest(string_to_array(v_folded, ' ')) AS term
    WHERE term <> ''
    LIMIT 8
  ) terms;
  IF cardinality(v_terms) = 0 THEN
    RAISE EXCEPTION 'search query must contain letters or digits' USING ERRCODE = '22023';
  END IF;
  -- The most selective term drives the trigram index on search_fold
  -- (20260926131000); the others filter the candidates. Words that appear in
  -- most association names are never the anchor unless nothing else is
  -- left. Folded terms contain only [a-z0-9], so they need no LIKE escaping.
  SELECT term INTO v_anchor
  FROM unnest(v_terms) AS term
  ORDER BY
    (term = ANY (ARRAY[
      'udruga', 'udruge', 'za', 'i', 'u', 'na', 'od', 'do', 's', 'sa', 'o',
      'hrvatska', 'hrvatski', 'hrvatsko', 'hrvatske', 'republike', 'grad', 'grada',
      'drustvo', 'klub', 'savez', 'centar', 'zajednica', 'sportski', 'sportska',
      'kulturno', 'umjetnicko', 'gradsko', 'opcine', 'zupanije',
      'zupa', 'zupe', 'crkva', 'crkve', 'sv', 'svetog', 'svete', 'zaklada', 'dom'
    ])) ASC,
    char_length(term) DESC,
    term
  LIMIT 1;
  -- An identifier typed on its own: OIB, UDR_ID or registry number, or a
  -- dotted evidence number of the Church or religious-community register.
  v_exact := CASE WHEN v_query ~ '^[0-9]{3,11}$' THEN v_query ELSE NULL END;
  v_exact_number := CASE WHEN v_query ~ '^[0-9][0-9.]{0,19}$' THEN replace(v_query, '.', '') ELSE NULL END;

  SELECT state.current_batch_id INTO v_batch_id
  FROM public.registry_publication_state state
  WHERE state.singleton = true;

  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'no registry snapshot is published' USING ERRCODE = 'P0002';
  END IF;

  -- Each register is matched and ranked inside its own bounded subquery
  -- (limit + 1 to report truncation); the merged list is ranked once more
  -- and the per-row claim state is computed only for the rows returned.
  SELECT
    coalesce(jsonb_agg(ranked.item ORDER BY ranked.ord) FILTER (WHERE ranked.ord <= v_limit), '[]'::jsonb),
    count(*)
  INTO v_items, v_rows
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY m.exact_hit DESC, m.name_starts DESC, m.name COLLATE public.hr_sort, m.id
      ) AS ord,
      jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'short_name', m.short_name,
        'status', m.status,
        'address', m.address,
        'city', m.city,
        'county', m.county,
        'registry_number', m.registry_number,
        'legal_form', m.legal_form,
        'registry_email', m.email,
        'register', m.register,
        'claim_state', CASE
          WHEN m.register = 'registar_udruga'
               AND m.institution_id IS NOT NULL
               AND NOT public.institution_is_adoptable(m.institution_id) THEN 'linked'
          WHEN m.register <> 'registar_udruga'
               AND public.official_organisation_is_linked(m.institution_id) THEN 'linked'
          WHEN EXISTS (
            SELECT 1 FROM public.institution_claims c
            WHERE c.udr_id = m.id
              AND c.status IN ('pending', 'email_sent', 'approved')
          ) THEN 'claimed'
          ELSE 'available'
        END
      ) AS item
    FROM (
      (
        SELECT
          d.udr_id AS id, d.name, d.short_name, d.status, d.address, d.city, d.county,
          d.registry_number, d.legal_form, d.email, d.institution_id,
          'registar_udruga'::text AS register,
          (v_exact IS NOT NULL
            AND (d.oib = v_exact OR d.udr_id = v_exact OR d.registry_number = v_exact)) AS exact_hit,
          (position(v_folded IN public.hr_fold(d.name)) = 1) AS name_starts
        FROM public.registry_directory_entries d
        WHERE d.batch_id = v_batch_id
          AND d.status = 'AKTIVAN'
          AND (v_county IS NULL OR d.county = v_county)
          AND d.search_fold LIKE '%' || v_anchor || '%'
          AND NOT EXISTS (
            SELECT 1 FROM unnest(v_terms) AS term
            WHERE position(term IN d.search_fold) = 0
          )
        ORDER BY exact_hit DESC, name_starts DESC, d.name COLLATE public.hr_sort, d.udr_id
        LIMIT v_limit + 1
      )
      UNION ALL
      (
        SELECT
          o.id, o.name, o.short_name, 'AKTIVAN'::text AS status, o.address, o.city, o.county,
          o.register_number AS registry_number, o.legal_form, o.email, o.institution_id,
          o.primary_register AS register,
          ((v_exact IS NOT NULL AND o.oib = v_exact)
            OR (v_exact_number IS NOT NULL AND replace(o.register_number, '.', '') = v_exact_number)
          ) AS exact_hit,
          (position(v_folded IN public.hr_fold(o.name)) = 1) AS name_starts
        FROM public.official_organisations o
        WHERE o.status = 'active'
          AND (v_county IS NULL OR o.county = v_county)
          AND o.search_fold LIKE '%' || v_anchor || '%'
          AND NOT EXISTS (
            SELECT 1 FROM unnest(v_terms) AS term
            WHERE position(term IN o.search_fold) = 0
          )
        ORDER BY exact_hit DESC, name_starts DESC, o.name COLLATE public.hr_sort, o.id
        LIMIT v_limit + 1
      )
    ) m
  ) ranked;

  RETURN jsonb_build_object(
    'version', 1,
    'items', v_items,
    'limit', v_limit,
    'truncated', v_rows > v_limit
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Requesting a claim.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_organisation_claim_transaction(p_actor_id uuid, p_key text, p_contact_email text, p_note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_claim public.institution_claims%ROWTYPE;
  v_org public.official_organisations%ROWTYPE;
  v_key text := btrim(coalesce(p_key, ''));
  v_email text := lower(btrim(coalesce(p_contact_email, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_key) < 1 OR char_length(v_key) > 64 OR NOT public.is_official_organisation_key(v_key) THEN
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

  SELECT o.* INTO v_org
  FROM public.official_organisations o
  WHERE o.id = v_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation is not in the published registry snapshot'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'organisation is not active in the official register'
      USING ERRCODE = 'P0001';
  END IF;
  IF public.official_organisation_is_linked(v_org.institution_id) THEN
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
    WHERE c.udr_id = v_key AND c.status IN ('pending', 'email_sent', 'approved')
  ) THEN
    RAISE EXCEPTION 'this organisation already has a claim under review' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.institution_claims (
    profile_id, udr_id, status, contact_email, evidence_note
  ) VALUES (
    p_actor_id, v_key, 'pending', v_email, v_note
  )
  RETURNING * INTO v_claim;

  INSERT INTO public.notifications (user_id, title, body, link)
  SELECT
    p.id,
    'Novi zahtjev organizacije',
    left(v_org.name, 200) || ' čeka pregled.',
    '/dashboard/admin'
  FROM public.profiles p
  WHERE p.role = 'superadmin';

  PERFORM public.append_audit_log_event(
    p_actor_id,
    NULL,
    'institution_claim.request',
    'institution_claim',
    v_claim.id,
    jsonb_build_object(
      'udr_id', v_key,
      'register', v_org.primary_register,
      'organisation_name', v_org.name,
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
      'id', v_org.id,
      'name', v_org.name,
      'city', v_org.city,
      'county', v_org.county,
      'address', v_org.address,
      'registry_email', v_org.email,
      'register', v_org.primary_register
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.request_organisation_claim_transaction(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_organisation_claim_transaction(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.request_institution_claim_transaction(p_actor_id uuid, p_udr_id text, p_contact_email text, p_note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  -- Organisations outside the associations register (20261005120000).
  IF public.is_official_organisation_key(btrim(coalesce(p_udr_id, ''))) THEN
    RETURN public.request_organisation_claim_transaction(
      p_actor_id, btrim(p_udr_id), p_contact_email, p_note
    );
  END IF;
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
  -- An institution the rule promoter created, and nobody holds, is adopted
  -- at approval; only a held one blocks the claim.
  IF v_directory.institution_id IS NOT NULL
     AND NOT public.institution_is_adoptable(v_directory.institution_id) THEN
    RAISE EXCEPTION 'organisation is already linked on the platform' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.institution_id INTO v_registry_institution_id
  FROM public.ngo_registry r
  WHERE r.udr_id = v_udr_id
  FOR UPDATE;

  IF v_registry_institution_id IS NOT NULL
     AND NOT public.institution_is_adoptable(v_registry_institution_id) THEN
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

  -- The review queue has no other alert; the bell polls these rows.
  INSERT INTO public.notifications (user_id, title, body, link)
  SELECT
    p.id,
    'Novi zahtjev udruge',
    left(v_directory.name, 200) || ' čeka pregled.',
    '/dashboard/admin'
  FROM public.profiles p
  WHERE p.role = 'superadmin';

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
$function$;

-- ---------------------------------------------------------------------------
-- 7. The mailbox challenge and its confirmation.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_institution_claim_email_verification(p_actor_id uuid, p_claim_id uuid, p_token_hash text, p_expires_at timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_claim public.institution_claims%ROWTYPE;
  v_batch_id text;
  v_registry_email text;
  v_email_source text;
  v_name text;
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

  IF public.is_official_organisation_key(v_claim.udr_id) THEN
    SELECT nullif(lower(btrim(coalesce(o.email, ''))), ''), o.email_source, o.name
    INTO v_registry_email, v_email_source, v_name
    FROM public.official_organisations o
    WHERE o.id = v_claim.udr_id AND o.status = 'active';
  ELSE
    SELECT state.current_batch_id INTO v_batch_id
    FROM public.registry_publication_state state
    WHERE state.singleton = true;

    SELECT nullif(lower(btrim(coalesce(d.email, ''))), ''), 'registar_udruga', d.name
    INTO v_registry_email, v_email_source, v_name
    FROM public.registry_directory_entries d
    WHERE d.batch_id = v_batch_id AND d.udr_id = v_claim.udr_id;
  END IF;

  -- A mailbox challenge only proves something when the mailbox is the one an
  -- official register publishes, so it always goes there. The applicant's
  -- typed contact address is correspondence only and no longer has to match.
  IF v_registry_email IS NULL THEN
    RAISE EXCEPTION 'the official register publishes no email for this organisation'
      USING ERRCODE = 'P0001';
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
    jsonb_build_object(
      'udr_id', v_claim.udr_id,
      'expires_at', p_expires_at,
      'email_source', v_email_source
    )
  );

  -- contact_email carries the register address as well, so a route that
  -- sends to contact_email still reaches the right mailbox.
  RETURN jsonb_build_object(
    'id', v_claim.id,
    'status', v_claim.status,
    'email_token_expires_at', v_claim.email_token_expires_at,
    'contact_email', v_registry_email,
    'registry_email', v_registry_email,
    'email_source', v_email_source,
    'organisation_name', v_name,
    'applicant_contact_email', v_claim.contact_email
  );
END;
$function$;

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

  IF public.is_official_organisation_key(v_claim.udr_id) THEN
    SELECT o.name INTO v_name
    FROM public.official_organisations o
    WHERE o.id = v_claim.udr_id;
  ELSE
    SELECT state.current_batch_id INTO v_batch_id
    FROM public.registry_publication_state state
    WHERE state.singleton = true;

    SELECT d.name INTO v_name
    FROM public.registry_directory_entries d
    WHERE d.batch_id = v_batch_id AND d.udr_id = v_claim.udr_id;
  END IF;

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

-- ---------------------------------------------------------------------------
-- 8. Reads: the applicant's own claim and the review queue.
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
      'name', coalesce(d.name, o.name),
      'city', coalesce(d.city, o.city),
      'county', coalesce(d.county, o.county),
      'address', coalesce(d.address, o.address),
      'registry_email', coalesce(d.email, o.email),
      'register', CASE WHEN o.id IS NOT NULL THEN o.primary_register ELSE 'registar_udruga' END
    )
  )
  INTO v_claim
  FROM public.institution_claims c
  LEFT JOIN public.registry_directory_entries d
    ON d.batch_id = v_batch_id AND d.udr_id = c.udr_id
  LEFT JOIN public.official_organisations o
    ON o.id = c.udr_id
  WHERE c.profile_id = p_actor_id
  ORDER BY
    CASE WHEN c.status IN ('pending', 'email_sent') THEN 0 ELSE 1 END,
    c.created_at DESC
  LIMIT 1;

  RETURN coalesce(v_claim, 'null'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_institution_claims_for_review(p_reviewer_id uuid, p_status text DEFAULT 'open'::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_reviewer_role text;
  v_batch_id text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_status text := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'open');
  v_items jsonb;
  v_total integer;
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

  SELECT count(*)::integer INTO v_total
  FROM public.institution_claims c
  WHERE (v_status = 'open' AND c.status IN ('pending', 'email_sent'))
     OR (v_status = 'all')
     OR (c.status = v_status);

  -- The open queue is worked oldest first, so the earliest applicants do not
  -- wait longest; history views stay newest first.
  SELECT coalesce(jsonb_agg(item ORDER BY sort_key, sort_id), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      CASE WHEN v_status = 'open'
        THEN extract(epoch FROM c.created_at)
        ELSE -extract(epoch FROM c.created_at)
      END AS sort_key,
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
        'organisation', CASE
          WHEN d.udr_id IS NOT NULL THEN jsonb_build_object(
            'id', d.udr_id,
            'register', 'registar_udruga',
            'name', d.name,
            'short_name', d.short_name,
            'status', d.status,
            'address', d.address,
            'city', d.city,
            'county', d.county,
            'oib', d.oib,
            'registry_number', d.registry_number,
            'legal_form', d.legal_form,
            'registry_email', d.email,
            'website', d.website,
            'already_linked', d.institution_id IS NOT NULL
              AND NOT public.institution_is_adoptable(d.institution_id),
            -- What approval would publish, and the classifier's standing, so
            -- the reviewer can choose a category (20260927110000).
            'category', d.category,
            'classification_status', r.classification_status,
            'suggested_category', CASE
              WHEN r.classification_status = 'needs_review' THEN r.mapped_category
            END
          )
          WHEN o.id IS NOT NULL THEN jsonb_build_object(
            'id', o.id,
            'register', o.primary_register,
            'registers', o.registers,
            'name', o.name,
            'short_name', o.short_name,
            'status', CASE WHEN o.status = 'active' THEN 'AKTIVAN' ELSE 'NEAKTIVAN' END,
            'address', o.address,
            'city', o.city,
            'county', o.county,
            'oib', o.oib,
            'registry_number', o.register_number,
            'legal_form', o.legal_form,
            'registry_email', o.email,
            'email_source', o.email_source,
            'website', o.website,
            'phone', o.phone,
            'social_provider', o.social_provider,
            'already_linked', public.official_organisation_is_linked(o.institution_id),
            'category', NULL,
            'classification_status', NULL,
            'suggested_category', NULL
          )
        END
      ) AS item
    FROM public.institution_claims c
    JOIN public.profiles p ON p.id = c.profile_id
    LEFT JOIN public.registry_directory_entries d
      ON d.batch_id = v_batch_id AND d.udr_id = c.udr_id
    LEFT JOIN public.ngo_registry r ON r.udr_id = c.udr_id
    LEFT JOIN public.official_organisations o ON o.id = c.udr_id
    WHERE (
      (v_status = 'open' AND c.status IN ('pending', 'email_sent'))
      OR (v_status = 'all')
      OR (c.status = v_status)
    )
    ORDER BY sort_key, c.id
    LIMIT v_limit
  ) rows_for_review;

  RETURN jsonb_build_object('version', 1, 'items', v_items, 'limit', v_limit, 'total', v_total);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Approval.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_organisation_claim_transaction(p_reviewer_id uuid, p_claim_id uuid, p_note text DEFAULT NULL::text, p_category text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_reviewer_role text;
  v_claim public.institution_claims%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_org public.official_organisations%ROWTYPE;
  v_target public.institutions%ROWTYPE;
  v_institution public.institutions%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_now timestamptz := now();
  v_adopt_id uuid;
  v_lat double precision;
  v_lng double precision;
  v_hidden boolean;
  v_precision text;
  v_centroid_lat double precision;
  v_centroid_lng double precision;
  v_centroid_count integer;
  v_category text;
  v_area text;
  v_social constant text[] := ARRAY[
    'homeless_shelter', 'soup_kitchen', 'children_home', 'caritas',
    'disability_support', 'domestic_violence', 'elderly_care', 'social_welfare',
    'student_housing', 'mental_health', 'refugee_migrant_support', 'medical_patient_support'
  ];
  v_requested_category text := nullif(btrim(coalesce(p_category, '')), '');
BEGIN
  IF p_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'review note is too long' USING ERRCODE = '22023';
  END IF;
  IF v_requested_category IS NOT NULL AND NOT (v_requested_category = ANY (v_social)) THEN
    RAISE EXCEPTION 'invalid category' USING ERRCODE = '22023';
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
  IF NOT public.is_official_organisation_key(v_claim.udr_id) THEN
    RAISE EXCEPTION 'claim is not for an organisation outside the associations register'
      USING ERRCODE = '22023';
  END IF;
  IF v_claim.status NOT IN ('pending', 'email_sent') THEN
    RAISE EXCEPTION 'claim is no longer open' USING ERRCODE = 'P0001';
  END IF;
  -- Same rule as for associations: the register mailbox, or a recorded check.
  IF v_claim.email_consumed_at IS NULL
     AND (v_note IS NULL OR v_note !~* '^[[:space:]]*provjereno[[:space:]]*:') THEN
    RAISE EXCEPTION 'mailbox not verified; record the out-of-band check in the note'
      USING ERRCODE = 'P0001';
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

  SELECT o.* INTO v_org
  FROM public.official_organisations o
  WHERE o.id = v_claim.udr_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation is not in the published registry snapshot'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'organisation is not active in the official register'
      USING ERRCODE = 'P0001';
  END IF;
  IF public.official_organisation_is_linked(v_org.institution_id) THEN
    RAISE EXCEPTION 'organisation is already linked on the platform' USING ERRCODE = 'P0001';
  END IF;
  -- The organisation's own institution nobody holds (its Caritas pin from
  -- the register, or an earlier one whose account is gone) is taken over,
  -- as an association's unheld promoter row is.
  v_adopt_id := v_org.institution_id;
  IF v_adopt_id IS NOT NULL THEN
    SELECT i.* INTO v_target
    FROM public.institutions i
    WHERE i.id = v_adopt_id
    FOR UPDATE;
    IF NOT FOUND THEN
      v_adopt_id := NULL;
    END IF;
  END IF;

  -- The reviewer chooses a social category; the registers carry none.
  v_category := v_requested_category;
  IF v_category IS NULL OR NOT (v_category = ANY (v_social)) THEN
    RAISE EXCEPTION 'choose a social category for this organisation'
      USING ERRCODE = '22023';
  END IF;

  -- Coordinate provenance: the seat's DGU building, else a coarse point in
  -- its place, published hidden. Never a fabricated building.
  IF v_org.geocode_source = 'dgu_inspire_addresses'
     AND v_org.lat BETWEEN 42 AND 47 AND v_org.lng BETWEEN 13 AND 20 THEN
    v_lat := v_org.lat;
    v_lng := v_org.lng;
    v_hidden := false;
    v_precision := 'exact';
  ELSE
    IF v_org.county IS NOT NULL THEN
      SELECT c.latitude, c.longitude, 1
      INTO v_centroid_lat, v_centroid_lng, v_centroid_count
      FROM public.registry_location_centroids c
      WHERE c.county_key = public.registry_location_key(v_org.county)
        AND c.city_key = public.registry_location_key(v_org.city);
    END IF;
    IF v_centroid_lat IS NULL AND v_org.city IS NOT NULL THEN
      -- The Church register names no county; a place name that exists in
      -- one county only is still unambiguous.
      SELECT min(c.latitude), min(c.longitude), count(*)::integer
      INTO v_centroid_lat, v_centroid_lng, v_centroid_count
      FROM public.registry_location_centroids c
      WHERE c.city_key = public.registry_location_key(v_org.city)
        AND c.city_key <> '';
      IF v_centroid_count <> 1 THEN
        v_centroid_lat := NULL;
        v_centroid_lng := NULL;
      END IF;
    END IF;
    IF v_centroid_lat IS NULL OR v_centroid_lng IS NULL THEN
      RAISE EXCEPTION 'the register has no usable location for this organisation'
        USING ERRCODE = 'P0001';
    END IF;
    SELECT point.latitude, point.longitude, point.location_precision
    INTO v_lat, v_lng, v_precision
    FROM public.registry_public_map_point(
      v_org.id, v_org.city, v_org.county, v_centroid_lat, v_centroid_lng, NULL
    ) point;
    v_hidden := true;
  END IF;

  IF v_category = 'domestic_violence' THEN
    v_hidden := true;
  END IF;
  v_area := nullif(concat_ws(', ', v_org.city, v_org.county), '');

  IF v_adopt_id IS NOT NULL THEN
    UPDATE public.institutions i
    SET name = v_org.name,
        category = v_category,
        address = coalesce(v_org.address, v_org.city, v_org.county, ''),
        city = coalesce(v_org.city, v_org.county, ''),
        lat = v_lat,
        lng = v_lng,
        email = coalesce(v_org.email, i.email),
        website = coalesce(v_org.website, i.website),
        phone = coalesce(v_org.phone, i.phone),
        is_verified = true,
        is_location_hidden = v_hidden,
        approximate_area = CASE WHEN v_hidden THEN v_area END,
        source = 'organisation_claim',
        oib = CASE WHEN coalesce(v_org.oib, '') ~ '^[0-9]{11}$' THEN v_org.oib ELSE i.oib END,
        updated_at = v_now
    WHERE i.id = v_adopt_id
    RETURNING * INTO v_institution;
  ELSE
    INSERT INTO public.institutions (
      name, category, description, address, city, lat, lng,
      email, website, phone, is_verified, is_location_hidden, approximate_area,
      source, oib
    ) VALUES (
      v_org.name,
      v_category,
      '',
      coalesce(v_org.address, v_org.city, v_org.county, ''),
      coalesce(v_org.city, v_org.county, ''),
      v_lat,
      v_lng,
      v_org.email,
      v_org.website,
      v_org.phone,
      -- Verified because a human reviewed this claim, not because it was typed.
      true,
      v_hidden,
      CASE WHEN v_hidden THEN v_area END,
      'organisation_claim',
      CASE WHEN coalesce(v_org.oib, '') ~ '^[0-9]{11}$' THEN v_org.oib END
    )
    RETURNING * INTO v_institution;
  END IF;

  UPDATE public.official_organisations o
  SET institution_id = v_institution.id, updated_at = v_now
  WHERE o.id = v_org.id;

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

  INSERT INTO public.notifications (user_id, title, body, link)
  VALUES (
    v_claim.profile_id,
    'Zahtjev je odobren',
    'Vaš račun sada upravlja profilom organizacije ' || left(v_institution.name, 200)
      || '. Možete dopuniti profil i objavljivati potrebe i volonterske događaje.',
    '/dashboard/institution'
  );

  PERFORM public.append_audit_log_event(
    p_reviewer_id,
    NULL,
    'institution_claim.approve',
    'institution_claim',
    v_claim.id,
    jsonb_build_object(
      'udr_id', v_claim.udr_id,
      'register', v_org.primary_register,
      'institution_id', v_institution.id,
      'adopted_institution', v_adopt_id IS NOT NULL,
      'applicant_profile_id', v_claim.profile_id,
      'email_verified', v_claim.email_consumed_at IS NOT NULL,
      'location_precision', v_precision,
      'is_location_hidden', v_hidden,
      'category', v_category,
      'category_chosen_by_reviewer', v_requested_category IS NOT NULL,
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
    'is_location_hidden', v_hidden,
    'category', v_category
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_organisation_claim_transaction(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_organisation_claim_transaction(uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.approve_institution_claim_transaction(p_reviewer_id uuid, p_claim_id uuid, p_note text DEFAULT NULL::text, p_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
  v_adopt_id uuid;
  -- The twelve social categories; SOCIAL_MAP_CATEGORIES in
  -- src/lib/location-map.ts. Everything else is the `association` catch-all.
  v_social constant text[] := ARRAY[
    'homeless_shelter', 'soup_kitchen', 'children_home', 'caritas',
    'disability_support', 'domestic_violence', 'elderly_care', 'social_welfare',
    'student_housing', 'mental_health', 'refugee_migrant_support', 'medical_patient_support'
  ];
  v_requested_category text := nullif(btrim(coalesce(p_category, '')), '');
BEGIN
  -- Organisations outside the associations register (20261005120000).
  IF EXISTS (
    SELECT 1 FROM public.institution_claims c
    WHERE c.id = p_claim_id AND public.is_official_organisation_key(c.udr_id)
  ) THEN
    RETURN public.approve_organisation_claim_transaction(
      p_reviewer_id, p_claim_id, p_note, p_category
    );
  END IF;
  IF p_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'review note is too long' USING ERRCODE = '22023';
  END IF;
  IF v_requested_category IS NOT NULL AND NOT (v_requested_category = ANY (v_social)) THEN
    RAISE EXCEPTION 'invalid category' USING ERRCODE = '22023';
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
  -- Account e-mails are not verified at sign-up, so they prove nothing. The
  -- register mailbox challenge proves control; without it the reviewer must
  -- record how the applicant was checked.
  IF v_claim.email_consumed_at IS NULL
     AND (v_note IS NULL OR v_note !~* '^[[:space:]]*provjereno[[:space:]]*:') THEN
    RAISE EXCEPTION 'mailbox not verified; record the out-of-band check in the note'
      USING ERRCODE = 'P0001';
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

  SELECT r.* INTO v_registry
  FROM public.ngo_registry r
  WHERE r.udr_id = v_claim.udr_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation is not in the canonical register' USING ERRCODE = 'P0002';
  END IF;

  IF v_directory.institution_id IS NOT NULL AND v_registry.institution_id IS NOT NULL
     AND v_directory.institution_id <> v_registry.institution_id THEN
    RAISE EXCEPTION 'the register and the directory link different institutions'
      USING ERRCODE = 'P0001';
  END IF;
  v_adopt_id := coalesce(v_directory.institution_id, v_registry.institution_id);
  IF v_adopt_id IS NOT NULL AND NOT public.institution_is_adoptable(v_adopt_id) THEN
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

  -- The reviewer's category wins, else the register's, and only a social one
  -- is accepted. Public listings show social associations only
  -- (20260927100000), so an approval in the `association` catch-all would
  -- build an account nobody can find on the map. The register's answer is
  -- a classifier's, not the organisation's (Jev leaves hundreds of rows for
  -- review), so the reviewer chooses a category or rejects the claim.
  v_category := coalesce(
    v_requested_category,
    nullif(btrim(coalesce(v_directory.category, '')), '')
  );
  IF v_category IS NULL OR NOT (v_category = ANY (v_social)) THEN
    RAISE EXCEPTION 'choose a social category for this organisation'
      USING ERRCODE = '22023';
  END IF;

  -- Violence-support organisations are never pinned at their registered seat
  -- (PROTECTED_LOCATION_CATEGORIES in src/lib/location-map.ts): a real shelter
  -- keeps its address unknown, and the category also holds counselling offices
  -- a map must not present as shelters.
  IF v_category = 'domestic_violence' THEN
    v_hidden := true;
  END IF;

  -- registry_oib is uniquely indexed; never let one claim steal another row's.
  v_registry_oib := nullif(btrim(coalesce(v_directory.oib, '')), '');
  IF v_registry_oib IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.institutions i
    WHERE i.registry_oib = v_registry_oib AND i.id IS DISTINCT FROM v_adopt_id
  ) THEN
    v_registry_oib := NULL;
  END IF;

  IF v_adopt_id IS NOT NULL THEN
    -- Adopt the unheld promoter row: same provenance rules as a new row, the
    -- register's own name and contacts, and any description it already had.
    UPDATE public.institutions i
    SET name = v_directory.name,
        category = v_category,
        description = CASE
          WHEN nullif(btrim(coalesce(i.description, '')), '') IS NOT NULL THEN i.description
          ELSE left(coalesce(
            nullif(btrim(coalesce(v_registry.opis_djelatnosti, '')), ''),
            nullif(btrim(coalesce(v_registry.ciljevi, '')), ''),
            ''
          ), 2000)
        END,
        address = coalesce(
          nullif(btrim(coalesce(v_directory.address, '')), ''),
          nullif(btrim(coalesce(v_directory.city, '')), ''),
          nullif(btrim(coalesce(v_directory.county, '')), ''),
          ''
        ),
        city = coalesce(
          nullif(btrim(coalesce(v_directory.city, '')), ''),
          nullif(btrim(coalesce(v_directory.county, '')), ''),
          ''
        ),
        lat = v_lat,
        lng = v_lng,
        email = coalesce(nullif(btrim(coalesce(v_directory.email, '')), ''), i.email),
        website = coalesce(nullif(btrim(coalesce(v_directory.website, '')), ''), i.website),
        is_verified = true,
        is_location_hidden = v_hidden,
        approximate_area = nullif(concat_ws(', ',
          nullif(btrim(coalesce(v_directory.city, '')), ''),
          nullif(btrim(coalesce(v_directory.county, '')), '')
        ), ''),
        source = 'registry_claim',
        registry_oib = coalesce(i.registry_oib, v_registry_oib),
        oib = CASE WHEN coalesce(v_directory.oib, '') ~ '^[0-9]{11}$' THEN v_directory.oib ELSE i.oib END,
        registry_last_verified_at = v_directory.last_verified_at
    WHERE i.id = v_adopt_id
    RETURNING * INTO v_institution;
  ELSE
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
  END IF;

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

  INSERT INTO public.notifications (user_id, title, body, link)
  VALUES (
    v_claim.profile_id,
    'Zahtjev je odobren',
    'Vaš račun sada upravlja profilom udruge ' || left(v_institution.name, 200)
      || '. Možete dopuniti profil i objavljivati potrebe i volonterske događaje.',
    '/dashboard/institution'
  );

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
      'adopted_institution', v_adopt_id IS NOT NULL,
      'applicant_profile_id', v_claim.profile_id,
      'email_verified', v_claim.email_consumed_at IS NOT NULL,
      'location_precision', v_precision,
      'is_location_hidden', v_hidden,
      'category', v_category,
      'category_chosen_by_reviewer', v_requested_category IS NOT NULL,
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
    'is_location_hidden', v_hidden,
    'category', v_category
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 10. The map lists claimed organisations that no register row places.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.map_association_registry_v1(p_min_lng double precision, p_min_lat double precision, p_max_lng double precision, p_max_lat double precision, p_zoom integer, p_categories text[] DEFAULT ARRAY[]::text[], p_donation_type text DEFAULT NULL::text, p_only_zagreb boolean DEFAULT false, p_only_urgent boolean DEFAULT false, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 150, p_only_onboarded boolean DEFAULT false, p_city text DEFAULT NULL::text)
 RETURNS TABLE(feature_kind text, feature_id text, institution_id uuid, registry_id text, entity_type text, name text, category text, city text, address text, approximate_area text, location_precision text, latitude double precision, longitude double precision, accepts_donations text[], is_verified boolean, is_location_hidden boolean, source text, has_urgent_need boolean, member_count bigint, min_lng double precision, min_lat double precision, max_lng double precision, max_lat double precision, total_matches bigint, total_features bigint, place_kind text, place_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  effective_limit integer := greatest(1, least(coalesce(p_limit, 150), 200));
  normalized_query text;
  normalized_city text;
  bbox_area double precision := (p_max_lng - p_min_lng) * (p_max_lat - p_min_lat);
  maximum_bbox_area double precision;
  axis_cells integer;
  query_terms text[];
  viewport extensions.geometry;
BEGIN
  IF length(coalesce(p_query, '')) > 256 THEN RAISE EXCEPTION 'search query input is too long'; END IF;
  IF length(coalesce(p_donation_type, '')) > 64 THEN RAISE EXCEPTION 'donation type input is too long'; END IF;
  IF length(coalesce(p_city, '')) > 150 THEN RAISE EXCEPTION 'city input is too long'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(p_categories, ARRAY[]::text[])) category_value
    WHERE length(category_value) > 64
  ) THEN RAISE EXCEPTION 'category input is too long'; END IF;

  normalized_query := nullif(
    public.hr_fold(coalesce(p_query, '')),
    ''
  );
  normalized_city := nullif(btrim(coalesce(p_city, '')), '');

  IF p_min_lng IS NULL OR p_min_lat IS NULL OR p_max_lng IS NULL OR p_max_lat IS NULL
     OR p_min_lng < -180 OR p_max_lng > 180 OR p_min_lat < -90 OR p_max_lat > 90
     OR p_min_lng >= p_max_lng OR p_min_lat >= p_max_lat THEN
    RAISE EXCEPTION 'invalid bounding box';
  END IF;
  IF p_zoom IS NULL OR p_zoom < 6 OR p_zoom > 19 THEN RAISE EXCEPTION 'zoom must be between 6 and 19'; END IF;
  maximum_bbox_area := 180.0 / power(2.0, greatest(0, p_zoom - 6));
  IF bbox_area > maximum_bbox_area THEN RAISE EXCEPTION 'bounding box is too large for zoom level'; END IF;
  IF coalesce(cardinality(p_categories), 0) > 12 THEN RAISE EXCEPTION 'too many categories'; END IF;
  IF normalized_query IS NOT NULL AND (length(normalized_query) < 2 OR length(normalized_query) > 80) THEN
    RAISE EXCEPTION 'invalid search query length';
  END IF;

  -- Most selective term first; see search_association_registry_v1.
  query_terms := (
    SELECT array_agg(term ORDER BY (term = ANY (ARRAY['udruga', 'udruge', 'za', 'i', 'u', 'na', 'od', 'do', 's', 'sa', 'o', 'hrvatska', 'hrvatski', 'hrvatsko', 'hrvatske', 'republike', 'grad', 'grada', 'drustvo', 'klub', 'savez', 'centar', 'zajednica', 'sportski', 'sportska', 'kulturno', 'umjetnicko', 'gradsko', 'opcine', 'zupanije'])) ASC, length(term) DESC, term)
    FROM (
      SELECT term
      FROM unnest(string_to_array(coalesce(normalized_query, ''), ' ')) AS term
      WHERE length(term) >= 2
      LIMIT 6
    ) capped
  );
  IF coalesce(cardinality(query_terms), 0) = 0 AND normalized_query IS NOT NULL THEN
    query_terms := ARRAY[normalized_query];
  END IF;

  axis_cells := greatest(1, floor(sqrt(effective_limit::double precision))::integer);
  viewport := extensions.st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326);

  RETURN QUERY
  WITH urgent_institutions AS MATERIALIZED (
    SELECT DISTINCT need.institution_id
    FROM public.needs need
    WHERE need.urgency = 'urgent'
      AND need.is_fulfilled = false
      AND need.institution_id IS NOT NULL
  ), curated_base AS MATERIALIZED (
    SELECT
      i.id,
      i.city,
      CASE WHEN coalesce(i.is_location_hidden, false) THEN i.public_lat ELSE i.lat END AS point_lat,
      CASE WHEN coalesce(i.is_location_hidden, false) THEN i.public_lng ELSE i.lng END AS point_lng,
      EXISTS (SELECT 1 FROM urgent_institutions u WHERE u.institution_id = i.id) AS urgent
    FROM public.institutions i
    WHERE (
        (i.source IN ('curated', 'organisation_claim') AND i.is_verified = true)
        -- Caritas pins from the official registers (20261005120000), unverified.
        OR i.source = 'official_register'
      )
      AND NOT EXISTS (SELECT 1 FROM public.ngo_registry r WHERE r.institution_id = i.id)
      AND (coalesce(cardinality(p_categories), 0) = 0 OR i.category = ANY(p_categories))
      AND (p_donation_type IS NULL OR i.accepts_donations @> ARRAY[p_donation_type])
      AND (NOT p_only_zagreb OR lower(coalesce(i.city, '')) = 'zagreb' OR lower(coalesce(i.city, '')) LIKE 'zagreb %')
      AND (normalized_city IS NULL OR lower(i.city) = lower(normalized_city))
      AND (
        query_terms IS NULL
        OR (
          public.hr_fold(coalesce(i.search_text, i.name)) LIKE '%' || query_terms[1] || '%'
          AND NOT EXISTS (
            SELECT 1 FROM unnest(query_terms[2:]) AS term
            WHERE public.hr_fold(coalesce(i.search_text, i.name)) NOT LIKE '%' || term || '%'
          )
        )
      )
      AND (
        NOT p_only_onboarded
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.institution_id = i.id AND p.role = 'ngo')
      )
      AND (NOT p_only_urgent OR EXISTS (SELECT 1 FROM urgent_institutions u WHERE u.institution_id = i.id))
  ), curated_institutions AS MATERIALIZED (
    SELECT
      b.*,
      (
        SELECT d.county
        FROM public.registry_publication_state state
        JOIN public.registry_directory_entries d ON d.batch_id = state.current_batch_id
        WHERE state.singleton = true AND d.city = b.city AND d.county IS NOT NULL
        LIMIT 1
      ) AS county_name,
      (
        SELECT cd.name
        FROM public.city_districts cd
        WHERE lower(cd.city) = lower(b.city)
          AND extensions.st_contains(cd.boundary, extensions.st_setsrid(extensions.st_makepoint(b.point_lng, b.point_lat), 4326))
        LIMIT 1
      ) AS district_name
    FROM curated_base b
    WHERE b.point_lat IS NOT NULL
      AND b.point_lng IS NOT NULL
      AND extensions.st_setsrid(extensions.st_makepoint(b.point_lng, b.point_lat), 4326) && viewport
  ), candidates AS MATERIALIZED (
    -- Identity, coordinates and the four place keys. Each key coalesces to the
    -- next coarser one, so every tier covers every row: a viewport straddling
    -- Zagreb's boundary groups the Zagreb rows by district and its neighbours
    -- by city, in the same response, with no row silently dropped.
    SELECT
      d.udr_id,
      i.id AS linked_institution_id,
      d.map_lat,
      d.map_lng,
      d.county AS key_county,
      coalesce(d.city, d.county) AS key_city,
      coalesce(d.district, d.city, d.county) AS key_district,
      coalesce(d.street_key, d.district, d.city, d.county) AS key_street,
      (i.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM urgent_institutions u WHERE u.institution_id = i.id
      )) AS urgent
    FROM public.registry_publication_state state
    JOIN public.registry_directory_entries d ON d.batch_id = state.current_batch_id
    LEFT JOIN public.institutions i ON i.id = d.institution_id
    WHERE state.singleton = true
      AND d.map_location IS NOT NULL
      AND (d.map_location)::extensions.geometry && viewport
      AND (coalesce(cardinality(p_categories), 0) = 0 OR coalesce(i.category, d.category, 'association') = ANY(p_categories))
      AND (p_donation_type IS NULL OR (i.id IS NOT NULL AND i.accepts_donations @> ARRAY[p_donation_type]))
      AND (NOT p_only_zagreb OR lower(coalesce(d.city, '')) = 'zagreb' OR lower(coalesce(d.city, '')) LIKE 'zagreb %')
      -- Exact city match, not a substring: the picker sends a value chosen from
      -- the register's own city list, and 'Zagreb' must not also drag in
      -- 'Zagrebacka' rows from the neighbouring county.
      AND (normalized_city IS NULL OR lower(d.city) = lower(normalized_city))
      AND (
        query_terms IS NULL
        OR (
          d.search_fold LIKE '%' || query_terms[1] || '%'
          AND NOT EXISTS (
            SELECT 1 FROM unnest(query_terms[2:]) AS term
            WHERE d.search_fold NOT LIKE '%' || term || '%'
          )
        )
      )
      -- "Onboarded" means a real account, not merely a linked institution row:
      -- the registry promotion pipeline bulk-inserts an institutions row for
      -- every donation candidate the classifier finds, with nobody behind it
      -- (source = 'registry'). 20260821130000_map_onboarded_requires_account.sql
      -- fixed this exact check to require an owning public.profiles row; the
      -- place-clustering rewrite in 20260822160000 recreated the function from
      -- an earlier copy and silently dropped that fix back to `i.id IS NOT
      -- NULL`, which every bulk-promoted candidate also satisfies.
      AND (
        NOT p_only_onboarded
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.institution_id = i.id AND p.role = 'ngo'
        )
      )
      AND (NOT p_only_urgent OR (i.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM urgent_institutions u WHERE u.institution_id = i.id
      )))
    UNION ALL
    -- Curated institutions that are not in the associations register (Caritas,
    -- parish soup kitchens, state children's homes, Red Cross shelters). Only
    -- reviewed rows (is_verified); typed-name test rows stay off the map. A
    -- hidden location only ever contributes its coarse public point.
    SELECT
      NULL::text,
      ci.id,
      ci.point_lat,
      ci.point_lng,
      coalesce(ci.county_name, ci.city),
      ci.city,
      coalesce(ci.district_name, ci.city),
      coalesce(ci.district_name, ci.city),
      ci.urgent
    FROM curated_institutions ci
  ), tier_groups AS (
    -- One hash aggregate over four grouping sets rather than four separate
    -- passes. The four-pass version scanned the materialised candidate set once
    -- per tier and pushed the Zagreb zoom-12 tail from 1.5s to 3.7s, back over
    -- the 3s statement_timeout the anon role carries - it would have restored
    -- the intermittent 503 this whole change set exists to remove.
    SELECT
      grouping(key_street) AS g_street,
      grouping(key_district) AS g_district,
      grouping(key_city) AS g_city,
      grouping(key_county) AS g_county,
      count(*)::bigint AS n
    FROM candidates
    GROUP BY GROUPING SETS ((key_street), (key_district), (key_city), (key_county))
  ), stats AS (
    SELECT
      -- key_county is never null, so its grouping set covers every candidate
      -- row exactly once and its total is the match count. Counting candidates
      -- separately would put the extra scan straight back.
      coalesce(sum(n) FILTER (WHERE g_county = 0), 0)::bigint AS matches,
      count(*) FILTER (WHERE g_street = 0)::bigint AS street_groups,
      coalesce(max(n) FILTER (WHERE g_street = 0), 0)::bigint AS street_biggest,
      count(*) FILTER (WHERE g_district = 0)::bigint AS district_groups,
      coalesce(max(n) FILTER (WHERE g_district = 0), 0)::bigint AS district_biggest,
      count(*) FILTER (WHERE g_city = 0)::bigint AS city_groups,
      coalesce(max(n) FILTER (WHERE g_city = 0), 0)::bigint AS city_biggest,
      count(*) FILTER (WHERE g_county = 0)::bigint AS county_groups,
      coalesce(max(n) FILTER (WHERE g_county = 0), 0)::bigint AS county_biggest
    FROM tier_groups
  ), tier AS (
    SELECT CASE
      WHEN s.matches <= effective_limit THEN 'individual'

      -- Pass one, finest first: a tier that fits the budget and actually
      -- subdivides what is on screen. The share test is what the first cut of
      -- this lacked. Zoomed inside Donji grad the district tier resolved into
      -- two groups holding 908 and 157 rows: it "fit" the budget, so it won,
      -- and the visitor got back a pin for the district they had just zoomed
      -- into. A group holding more than half the viewport is not a division of
      -- it, so require the largest to be at most half.
      WHEN s.street_groups BETWEEN 2 AND effective_limit
        AND s.street_biggest * 2 <= s.matches THEN 'street'
      WHEN s.district_groups BETWEEN 2 AND effective_limit
        AND s.district_biggest * 2 <= s.matches THEN 'district'
      WHEN s.city_groups BETWEEN 2 AND effective_limit
        AND s.city_biggest * 2 <= s.matches THEN 'city'
      WHEN s.county_groups BETWEEN 2 AND effective_limit
        AND s.county_biggest * 2 <= s.matches THEN 'county'

      -- Pass two, coarsest first: nothing divided the viewport cleanly, so take
      -- the coarsest tier that still resolves into more places than the budget
      -- and show the biggest of them. Coarsest first is the whole point - over
      -- Dalmatia it picks the 150 largest towns, where finest-first would pick
      -- 150 arbitrary streets scattered across the coast. The ORDER BY and
      -- LIMIT below do the truncating, and total_features still reports the
      -- real group count, so the client's existing "not everything is shown"
      -- notice fires on its own.
      WHEN s.county_groups > effective_limit THEN 'county'
      WHEN s.city_groups > effective_limit THEN 'city'
      WHEN s.district_groups > effective_limit THEN 'district'
      WHEN s.street_groups > effective_limit THEN 'street'

      ELSE 'grid'
    END AS kind
    FROM stats s
  ), place_clusters AS (
    SELECT
      t.kind AS grp_kind,
      CASE t.kind
        WHEN 'street' THEN c.key_street
        WHEN 'district' THEN c.key_district
        WHEN 'city' THEN c.key_city
        ELSE c.key_county
      END AS grp_name,
      avg(c.map_lat) AS cluster_lat,
      avg(c.map_lng) AS cluster_lng,
      count(*)::bigint AS cluster_count,
      min(c.map_lng) AS cluster_min_lng,
      min(c.map_lat) AS cluster_min_lat,
      max(c.map_lng) AS cluster_max_lng,
      max(c.map_lat) AS cluster_max_lat,
      bool_or(c.urgent) AS cluster_urgent
    FROM candidates c CROSS JOIN tier t
    WHERE t.kind IN ('street', 'district', 'city', 'county')
    GROUP BY 1, 2
  ), grid_clusters AS (
    SELECT
      least(axis_cells - 1, greatest(0, floor((c.map_lng - p_min_lng) / ((p_max_lng - p_min_lng) / axis_cells))::integer)) AS cell_x,
      least(axis_cells - 1, greatest(0, floor((c.map_lat - p_min_lat) / ((p_max_lat - p_min_lat) / axis_cells))::integer)) AS cell_y,
      avg(c.map_lat) AS cluster_lat,
      avg(c.map_lng) AS cluster_lng,
      count(*)::bigint AS cluster_count,
      min(c.map_lng) AS cluster_min_lng,
      min(c.map_lat) AS cluster_min_lat,
      max(c.map_lng) AS cluster_max_lng,
      max(c.map_lat) AS cluster_max_lat,
      bool_or(c.urgent) AS cluster_urgent
    FROM candidates c CROSS JOIN tier t
    WHERE t.kind = 'grid'
    GROUP BY cell_x, cell_y
  ), all_clusters AS (
    SELECT
      pc.grp_kind,
      pc.grp_name,
      'place:' || pc.grp_kind || ':' || pc.grp_name AS feature_id,
      cluster_lat, cluster_lng, cluster_count,
      cluster_min_lng, cluster_min_lat, cluster_max_lng, cluster_max_lat,
      cluster_urgent
    FROM place_clusters pc
    UNION ALL
    SELECT
      'grid',
      NULL,
      'registry-cluster:' || p_zoom::text || ':' || cell_x::text || ':' || cell_y::text,
      cluster_lat, cluster_lng, cluster_count,
      cluster_min_lng, cluster_min_lat, cluster_max_lng, cluster_max_lat,
      cluster_urgent
    FROM grid_clusters
  ), counted_clusters AS (
    SELECT a.*, count(*) OVER ()::bigint AS feature_count FROM all_clusters a
  ), individual_keys AS (
    SELECT c.*, s.matches FROM candidates c CROSS JOIN stats s WHERE s.matches <= effective_limit
  ), individual_rows AS (
    SELECT
      k.udr_id,
      k.linked_institution_id,
      CASE WHEN i.id IS NULL THEN 'registry' ELSE 'institution' END AS row_entity_type,
      coalesce(d.name, i.name) AS name,
      coalesce(i.category, d.category, 'association') AS row_category,
      coalesce(d.city, i.city) AS city,
      CASE WHEN i.id IS NOT NULL AND NOT coalesce(i.is_location_hidden, false) THEN i.address ELSE NULL END AS row_address,
      CASE
        WHEN i.id IS NOT NULL THEN i.approximate_area
        ELSE nullif(concat_ws(', ', nullif(d.city, ''), nullif(d.county, '')), '')
      END AS row_approximate_area,
      CASE
        WHEN d.udr_id IS NOT NULL THEN coalesce(d.map_precision, 'county')
        WHEN coalesce(i.is_location_hidden, false) THEN 'hidden'
        ELSE 'exact'
      END AS row_location_precision,
      k.map_lat,
      k.map_lng,
      CASE WHEN i.id IS NULL THEN ARRAY[]::text[] ELSE coalesce(i.accepts_donations, ARRAY[]::text[]) END AS row_donations,
      coalesce(i.is_verified, false) AS row_verified,
      coalesce(i.is_location_hidden, false) AS row_hidden,
      CASE WHEN i.id IS NULL THEN 'registry' ELSE i.source END AS row_source,
      k.urgent,
      k.matches
    FROM individual_keys k
    JOIN public.registry_publication_state state ON state.singleton = true
    LEFT JOIN public.registry_directory_entries d
      ON d.batch_id = state.current_batch_id AND d.udr_id = k.udr_id
    LEFT JOIN public.institutions i ON i.id = k.linked_institution_id
  ), combined AS (
    SELECT
      'cluster'::text AS feature_kind,
      c.feature_id,
      NULL::uuid AS institution_id,
      NULL::text AS registry_id,
      NULL::text AS entity_type,
      NULL::text AS name,
      NULL::text AS category,
      NULL::text AS city,
      NULL::text AS address,
      NULL::text AS approximate_area,
      NULL::text AS location_precision,
      c.cluster_lat::double precision AS latitude,
      c.cluster_lng::double precision AS longitude,
      ARRAY[]::text[] AS accepts_donations,
      false AS is_verified,
      false AS is_location_hidden,
      NULL::text AS source,
      c.cluster_urgent AS has_urgent_need,
      c.cluster_count AS member_count,
      c.cluster_min_lng::double precision AS min_lng,
      c.cluster_min_lat::double precision AS min_lat,
      c.cluster_max_lng::double precision AS max_lng,
      c.cluster_max_lat::double precision AS max_lat,
      s.matches AS total_matches,
      c.feature_count AS total_features,
      c.grp_kind,
      c.grp_name
    FROM counted_clusters c CROSS JOIN stats s
    UNION ALL
    SELECT
      'institution'::text,
      CASE WHEN f.linked_institution_id IS NULL THEN 'registry:' || f.udr_id ELSE f.linked_institution_id::text END,
      f.linked_institution_id,
      f.udr_id,
      f.row_entity_type,
      f.name,
      f.row_category,
      f.city,
      f.row_address,
      f.row_approximate_area,
      f.row_location_precision,
      f.map_lat,
      f.map_lng,
      f.row_donations,
      f.row_verified,
      f.row_hidden,
      f.row_source,
      f.urgent,
      1::bigint,
      f.map_lng,
      f.map_lat,
      f.map_lng,
      f.map_lat,
      f.matches,
      f.matches,
      NULL::text,
      NULL::text
    FROM individual_rows f
  )
  SELECT combined.*
  FROM combined
  ORDER BY combined.member_count DESC, combined.name NULLS LAST, combined.feature_id
  LIMIT effective_limit;
END;
$function$;

COMMIT;
