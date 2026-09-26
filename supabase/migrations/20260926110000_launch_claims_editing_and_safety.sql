-- Launch fixes for the 2026-09-28 association outreach.
--
-- 1. Claims. 2,501 active register rows were linked to institutions the old
--    rule promoter created (source = 'registry', no account, no content). The
--    claim search showed them as "Već preuzeto" and the request/approve RPCs
--    refused them, which hid 38-86% of the care-sector associations being
--    invited. Such an institution is now adopted by the approved claim instead
--    of blocking it. The claim search folds diacritics and punctuation on both
--    sides, requires every term and ranks exact identifiers first. Approval
--    needs either the register mailbox challenge or a recorded out-of-band
--    check ("Provjereno: ..."): account e-mails are not verified at sign-up,
--    so they prove nothing. Requests, approvals and rejections now notify the
--    people who have to act on them. The mailbox challenge always goes to the
--    address the register publishes, never to a typed one.
-- 2. Editing. Organisations can maintain their public profile and edit their
--    needs and volunteer events through service-only RPCs that decide
--    ownership themselves. Direct authenticated UPDATE on institutions is
--    revoked, like needs and volunteer_events in 20260926100000.
-- 3. Abuse. One free account could pledge the remaining quantity of every
--    need (which hides it) or fill every event; per-account limits stop that.
-- 4. Reminders use the Croatian calendar date, and a variant returns the
--    recipients whose reminder row is new, so the cron route can e-mail them
--    exactly once.
-- 5. Residuals from the 2026-09-26 security audit: role-checked NGO pledge
--    reads, text length bounds, notification policy hygiene, leftover grants
--    and NOT VALID constraints.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Search folding for Croatian text: lower case, č/ć/đ/š/ž and common Latin
-- diacritics to ASCII, "dj" to "d" (people type Đakovo as Djakovo), and every
-- run of punctuation or quotes to one space. Applied to both the stored text
-- and the query, so a query typed with diacritics still matches. Deliberately
-- no SET search_path so the planner can inline it; it calls only pg_catalog.
CREATE OR REPLACE FUNCTION public.hr_fold(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
    replace(
      translate(
        lower(p_value),
        'čćđšžäáàâãåëéèêïíìîöóòôõüúùûýÿñ',
        'ccdszaaaaaaeeeeiiiiooooouuuuyyn'
      ),
      'dj', 'd'
    ),
    '[^a-z0-9]+', ' ', 'g'
  ))
$$;

REVOKE ALL ON FUNCTION public.hr_fold(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_fold(text) TO service_role;

-- An institution the rule promoter created that nobody holds: no profile is
-- linked to it and no approved claim names it.
CREATE OR REPLACE FUNCTION public.institution_is_adoptable(p_institution_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.institutions i
    WHERE i.id = p_institution_id
      AND i.source = 'registry'
      AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.institution_id = i.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.institution_claims c
        WHERE c.institution_id = i.id AND c.status = 'approved'
      )
  )
$$;

REVOKE ALL ON FUNCTION public.institution_is_adoptable(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.institution_is_adoptable(uuid) TO service_role;

-- Validates one text value of a jsonb patch. NULL/empty clears the field when
-- the column is nullable. Raises 22023 naming the field otherwise.
CREATE OR REPLACE FUNCTION public.patch_text_value(
  p_value jsonb,
  p_field text,
  p_min integer,
  p_max integer,
  p_nullable boolean
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_text text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    IF p_nullable THEN RETURN NULL; END IF;
    RAISE EXCEPTION '% is required', p_field USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_value) <> 'string' THEN
    RAISE EXCEPTION '% must be text', p_field USING ERRCODE = '22023';
  END IF;
  v_text := btrim(p_value #>> '{}');
  IF v_text = '' THEN
    IF p_nullable THEN RETURN NULL; END IF;
    RAISE EXCEPTION '% is required', p_field USING ERRCODE = '22023';
  END IF;
  IF char_length(v_text) < p_min OR char_length(v_text) > p_max THEN
    RAISE EXCEPTION '% must contain % to % characters', p_field, p_min, p_max USING ERRCODE = '22023';
  END IF;
  RETURN v_text;
END;
$$;

REVOKE ALL ON FUNCTION public.patch_text_value(jsonb, text, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patch_text_value(jsonb, text, integer, integer, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 1. Claims
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
  -- The most selective term drives the trigram index on hr_fold(search_text)
  -- (20260926111000); the others filter the candidates. Words that appear in
  -- most association names are never the anchor unless nothing else is
  -- left. Folded terms contain only [a-z0-9], so they need no LIKE escaping.
  SELECT term INTO v_anchor
  FROM unnest(v_terms) AS term
  ORDER BY
    (term = ANY (ARRAY[
      'udruga', 'udruge', 'za', 'i', 'u', 'na', 'od', 'do', 's', 'sa', 'o',
      'hrvatska', 'hrvatski', 'hrvatsko', 'hrvatske', 'republike', 'grad', 'grada',
      'drustvo', 'klub', 'savez', 'centar', 'zajednica', 'sportski', 'sportska',
      'kulturno', 'umjetnicko', 'gradsko', 'opcine', 'zupanije'
    ])) ASC,
    char_length(term) DESC,
    term
  LIMIT 1;
  -- An identifier typed on its own: OIB, UDR_ID or registry number.
  v_exact := CASE WHEN v_query ~ '^[0-9]{3,11}$' THEN v_query ELSE NULL END;

  SELECT state.current_batch_id INTO v_batch_id
  FROM public.registry_publication_state state
  WHERE state.singleton = true;

  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'no registry snapshot is published' USING ERRCODE = 'P0002';
  END IF;

  -- Match and rank inside a bounded subquery (limit + 1 to report truncation);
  -- the per-row claim state is computed only for the rows returned.
  SELECT
    coalesce(jsonb_agg(ranked.item ORDER BY ranked.ord) FILTER (WHERE ranked.ord <= v_limit), '[]'::jsonb),
    count(*)
  INTO v_items, v_rows
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY m.exact_hit DESC, m.name_starts DESC, m.name COLLATE public.hr_sort, m.udr_id
      ) AS ord,
      jsonb_build_object(
        'id', m.udr_id,
        'name', m.name,
        'short_name', m.short_name,
        'status', m.status,
        'address', m.address,
        'city', m.city,
        'county', m.county,
        'registry_number', m.registry_number,
        'legal_form', m.legal_form,
        'registry_email', m.email,
        'claim_state', CASE
          WHEN m.institution_id IS NOT NULL
               AND NOT public.institution_is_adoptable(m.institution_id) THEN 'linked'
          WHEN EXISTS (
            SELECT 1 FROM public.institution_claims c
            WHERE c.udr_id = m.udr_id
              AND c.status IN ('pending', 'email_sent', 'approved')
          ) THEN 'claimed'
          ELSE 'available'
        END
      ) AS item
    FROM (
      SELECT
        d.udr_id, d.name, d.short_name, d.status, d.address, d.city, d.county,
        d.registry_number, d.legal_form, d.email, d.institution_id,
        (v_exact IS NOT NULL
          AND (d.oib = v_exact OR d.udr_id = v_exact OR d.registry_number = v_exact)) AS exact_hit,
        (position(v_folded IN public.hr_fold(d.name)) = 1) AS name_starts
      FROM public.registry_directory_entries d
      WHERE d.batch_id = v_batch_id
        AND d.status = 'AKTIVAN'
        AND (v_county IS NULL OR d.county = v_county)
        AND public.hr_fold(d.search_text) LIKE '%' || v_anchor || '%'
        AND NOT EXISTS (
          SELECT 1 FROM unnest(v_terms) AS term
          WHERE position(term IN public.hr_fold(d.search_text)) = 0
        )
      ORDER BY exact_hit DESC, name_starts DESC, d.name COLLATE public.hr_sort, d.udr_id
      LIMIT v_limit + 1
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

CREATE OR REPLACE FUNCTION public.approve_institution_claim_transaction(p_reviewer_id uuid, p_claim_id uuid, p_note text DEFAULT NULL::text)
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

  v_category := coalesce(nullif(btrim(coalesce(v_directory.category, '')), ''), 'association');

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
$function$;

CREATE OR REPLACE FUNCTION public.reject_institution_claim_transaction(p_reviewer_id uuid, p_claim_id uuid, p_note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  INSERT INTO public.notifications (user_id, title, body, link)
  VALUES (
    v_claim.profile_id,
    'Zahtjev nije odobren',
    coalesce('Obrazloženje: ' || left(v_note, 400) || ' ', '')
      || 'Novi zahtjev možete poslati kad god želite, a za pitanja pišite na kontakt@dajsrce.hr.',
    '/auth/setup'
  );

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
$function$;

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
        'organisation', CASE WHEN d.udr_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', d.udr_id,
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
            AND NOT public.institution_is_adoptable(d.institution_id)
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
    ORDER BY sort_key, c.id
    LIMIT v_limit
  ) rows_for_review;

  RETURN jsonb_build_object('version', 1, 'items', v_items, 'limit', v_limit, 'total', v_total);
END;
$function$;

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
    jsonb_build_object('udr_id', v_claim.udr_id, 'expires_at', p_expires_at)
  );

  -- contact_email carries the register address as well, so a route that
  -- sends to contact_email still reaches the right mailbox.
  RETURN jsonb_build_object(
    'id', v_claim.id,
    'status', v_claim.status,
    'email_token_expires_at', v_claim.email_token_expires_at,
    'contact_email', v_registry_email,
    'registry_email', v_registry_email,
    'applicant_contact_email', v_claim.contact_email
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_profile_setup(p_role text, p_institution_name text DEFAULT NULL::text)
RETURNS TABLE(profile_role text, profile_institution_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    -- An ngo account that never got an organisation (picked the wrong tile)
    -- may go back. Never demote a linked or privileged account.
    IF v_profile.role = 'ngo'
       AND v_profile.institution_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.institution_claims c
         WHERE c.profile_id = v_uid AND c.status IN ('pending', 'email_sent')
       ) THEN
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
$function$;

-- ---------------------------------------------------------------------------
-- 2. Editing: institutions, needs and volunteer events
-- ---------------------------------------------------------------------------

-- Organisation profiles change only through update_own_institution_profile.
DROP POLICY IF EXISTS "Authenticated users can create institutions" ON public.institutions;
DROP POLICY IF EXISTS "Institution users can update their own" ON public.institutions;
REVOKE UPDATE ON public.institutions FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (
  name, category, description, phone, email, website, working_hours,
  drop_off_hours, accepts_donations, capacity, served_population, photo_url,
  approximate_area, nearest_zet_stop, zet_lines
) ON public.institutions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_own_institution_profile(p_actor_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_institution public.institutions%ROWTYPE;
  v_key text;
  v_allowed constant text[] := ARRAY[
    'description', 'phone', 'email', 'website', 'working_hours', 'drop_off_hours', 'accepts_donations'
  ];
  v_donation_types constant text[] := ARRAY[
    'clothes', 'food', 'hygiene', 'toys_books', 'school_supplies', 'furniture',
    'medical_supplies', 'baby_items', 'blankets_bedding', 'money', 'time'
  ];
  v_description text;
  v_phone text;
  v_email text;
  v_website text;
  v_working_hours text;
  v_drop_off_hours text;
  v_accepts text[];
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch must be an object' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'field % cannot be changed', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Ownership comes from the actor's own profile, never from the request.
  SELECT p.* INTO v_profile FROM public.profiles p WHERE p.id = p_actor_id;
  IF NOT FOUND OR v_profile.role <> 'ngo' OR v_profile.institution_id IS NULL THEN
    RAISE EXCEPTION 'only a linked organisation account can edit its profile' USING ERRCODE = '42501';
  END IF;

  SELECT i.* INTO v_institution
  FROM public.institutions i
  WHERE i.id = v_profile.institution_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'P0002';
  END IF;

  v_description := CASE WHEN p_patch ? 'description'
    THEN public.patch_text_value(p_patch->'description', 'description', 1, 2000, true)
    ELSE v_institution.description END;

  v_phone := CASE WHEN p_patch ? 'phone'
    THEN public.patch_text_value(p_patch->'phone', 'phone', 6, 40, true)
    ELSE v_institution.phone END;
  IF p_patch ? 'phone' AND v_phone IS NOT NULL AND v_phone !~ '^[0-9 +()/.-]{6,40}$' THEN
    RAISE EXCEPTION 'phone may contain only digits, spaces and + ( ) / - .' USING ERRCODE = '22023';
  END IF;

  v_email := CASE WHEN p_patch ? 'email'
    THEN lower(public.patch_text_value(p_patch->'email', 'email', 5, 254, true))
    ELSE v_institution.email END;
  IF p_patch ? 'email' AND v_email IS NOT NULL
     AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' THEN
    RAISE EXCEPTION 'email is not valid' USING ERRCODE = '22023';
  END IF;

  v_website := CASE WHEN p_patch ? 'website'
    THEN public.patch_text_value(p_patch->'website', 'website', 8, 300, true)
    ELSE v_institution.website END;
  IF p_patch ? 'website' AND v_website IS NOT NULL
     AND v_website !~* '^https?://[^[:space:]/?#]+\.[^[:space:]/?#]+([/?#][^[:space:]]*)?$' THEN
    RAISE EXCEPTION 'website must be an http or https address' USING ERRCODE = '22023';
  END IF;

  v_working_hours := CASE WHEN p_patch ? 'working_hours'
    THEN public.patch_text_value(p_patch->'working_hours', 'working_hours', 1, 300, true)
    ELSE v_institution.working_hours END;

  v_drop_off_hours := CASE WHEN p_patch ? 'drop_off_hours'
    THEN public.patch_text_value(p_patch->'drop_off_hours', 'drop_off_hours', 1, 300, true)
    ELSE v_institution.drop_off_hours END;

  IF p_patch ? 'accepts_donations' THEN
    IF jsonb_typeof(p_patch->'accepts_donations') <> 'array' THEN
      RAISE EXCEPTION 'accepts_donations must be a list' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_patch->'accepts_donations') AS e(value)
      WHERE jsonb_typeof(e.value) <> 'string' OR NOT ((e.value #>> '{}') = ANY (v_donation_types))
    ) THEN
      RAISE EXCEPTION 'accepts_donations contains an unknown donation type' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(t ORDER BY t), '{}')
    INTO v_accepts
    FROM (SELECT DISTINCT e.value #>> '{}' AS t FROM jsonb_array_elements(p_patch->'accepts_donations') AS e(value)) s;
  END IF;

  UPDATE public.institutions i
  SET description = coalesce(v_description, ''),
      phone = v_phone,
      email = v_email,
      website = v_website,
      working_hours = v_working_hours,
      drop_off_hours = v_drop_off_hours,
      accepts_donations = CASE WHEN p_patch ? 'accepts_donations' THEN v_accepts ELSE i.accepts_donations END,
      -- The organisation itself said what it accepts; that is the confirmation
      -- a register classification can never be (invariant 8).
      donation_acceptance_confirmed = CASE
        WHEN p_patch ? 'accepts_donations' THEN true
        ELSE i.donation_acceptance_confirmed
      END
  WHERE i.id = v_institution.id
  RETURNING * INTO v_institution;

  PERFORM public.append_audit_log_event(
    p_actor_id,
    NULL,
    'institution.profile_update',
    'institution',
    v_institution.id,
    jsonb_build_object('fields', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_patch) AS k))
  );

  RETURN jsonb_build_object(
    'id', v_institution.id,
    'name', v_institution.name,
    'description', v_institution.description,
    'phone', v_institution.phone,
    'email', v_institution.email,
    'website', v_institution.website,
    'working_hours', v_institution.working_hours,
    'drop_off_hours', v_institution.drop_off_hours,
    'accepts_donations', to_jsonb(coalesce(v_institution.accepts_donations, '{}')),
    'donation_acceptance_confirmed', v_institution.donation_acceptance_confirmed,
    'updated_at', v_institution.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_own_institution_profile(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_institution_profile(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.update_need_transaction(p_actor_id uuid, p_need_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_need public.needs%ROWTYPE;
  v_key text;
  v_allowed constant text[] := ARRAY[
    'title', 'description', 'urgency', 'quantity_needed', 'deadline', 'is_fulfilled'
  ];
  v_title text;
  v_description text;
  v_urgency text;
  v_quantity integer;
  v_deadline timestamptz;
  v_fulfilled boolean;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch must be an object' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'field % cannot be changed', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT n.* INTO v_need FROM public.needs n WHERE n.id = p_need_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'need not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.* INTO v_profile FROM public.profiles p WHERE p.id = p_actor_id;
  IF NOT FOUND OR v_profile.role <> 'ngo' OR v_profile.institution_id IS NULL
     OR v_profile.institution_id <> v_need.institution_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_title := CASE WHEN p_patch ? 'title'
    THEN public.patch_text_value(p_patch->'title', 'title', 1, 160, false)
    ELSE v_need.title END;
  v_description := CASE WHEN p_patch ? 'description'
    THEN public.patch_text_value(p_patch->'description', 'description', 1, 4000, true)
    ELSE v_need.description END;

  v_urgency := v_need.urgency;
  IF p_patch ? 'urgency' THEN
    v_urgency := p_patch->>'urgency';
    IF v_urgency IS NULL OR v_urgency NOT IN ('routine', 'needed_soon', 'urgent') THEN
      RAISE EXCEPTION 'urgency is invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_quantity := v_need.quantity_needed;
  IF p_patch ? 'quantity_needed' THEN
    IF jsonb_typeof(p_patch->'quantity_needed') = 'null' THEN
      v_quantity := NULL;
    ELSIF jsonb_typeof(p_patch->'quantity_needed') <> 'number'
          OR (p_patch->>'quantity_needed') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'quantity_needed must be a whole number' USING ERRCODE = '22023';
    ELSE
      v_quantity := (p_patch->>'quantity_needed')::integer;
      IF v_quantity < 1 OR v_quantity > 1000000 THEN
        RAISE EXCEPTION 'quantity_needed must be between 1 and 1000000' USING ERRCODE = '22023';
      END IF;
      IF v_quantity < coalesce(v_need.quantity_pledged, 0) THEN
        RAISE EXCEPTION 'quantity below pledged' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  v_deadline := v_need.deadline;
  IF p_patch ? 'deadline' THEN
    IF jsonb_typeof(p_patch->'deadline') = 'null' OR btrim(coalesce(p_patch->>'deadline', '')) = '' THEN
      v_deadline := NULL;
    ELSIF (p_patch->>'deadline') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'deadline must be a real YYYY-MM-DD date' USING ERRCODE = '22023';
    ELSE
      BEGIN
        v_deadline := (p_patch->>'deadline')::date::timestamptz;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'deadline must be a real YYYY-MM-DD date' USING ERRCODE = '22023';
      END;
    END IF;
  END IF;

  -- Quantity-tracked needs are fulfilled by their pledges; the organisation
  -- can still close a need early or reopen one it closed by hand.
  v_fulfilled := CASE
    WHEN v_quantity IS NOT NULL AND coalesce(v_need.quantity_pledged, 0) >= v_quantity THEN true
    WHEN p_patch ? 'quantity_needed' AND NOT (p_patch ? 'is_fulfilled') THEN false
    ELSE coalesce(v_need.is_fulfilled, false)
  END;
  IF p_patch ? 'is_fulfilled' THEN
    IF jsonb_typeof(p_patch->'is_fulfilled') <> 'boolean' THEN
      RAISE EXCEPTION 'is_fulfilled must be true or false' USING ERRCODE = '22023';
    END IF;
    IF (p_patch->>'is_fulfilled')::boolean THEN
      v_fulfilled := true;
    ELSIF v_quantity IS NOT NULL AND coalesce(v_need.quantity_pledged, 0) >= v_quantity THEN
      RAISE EXCEPTION 'raise the quantity to reopen a fully pledged need' USING ERRCODE = '23514';
    ELSE
      v_fulfilled := false;
    END IF;
  END IF;

  UPDATE public.needs n
  SET title = v_title,
      description = v_description,
      urgency = v_urgency,
      quantity_needed = v_quantity,
      deadline = v_deadline,
      is_fulfilled = v_fulfilled
  WHERE n.id = v_need.id
  RETURNING * INTO v_need;

  PERFORM public.append_audit_log_event(
    p_actor_id,
    NULL,
    'need.update',
    'need',
    v_need.id,
    jsonb_build_object(
      'institution_id', v_need.institution_id,
      'fields', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_patch) AS k),
      'is_fulfilled', v_need.is_fulfilled
    )
  );

  RETURN jsonb_build_object(
    'id', v_need.id,
    'institution_id', v_need.institution_id,
    'title', v_need.title,
    'description', v_need.description,
    'donation_type', v_need.donation_type,
    'urgency', v_need.urgency,
    'quantity_needed', v_need.quantity_needed,
    'quantity_pledged', v_need.quantity_pledged,
    'deadline', v_need.deadline,
    'is_fulfilled', v_need.is_fulfilled,
    'created_at', v_need.created_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_need_transaction(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_need_transaction(uuid, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.update_volunteer_event_transaction(p_actor_id uuid, p_event_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_event public.volunteer_events%ROWTYPE;
  v_before public.volunteer_events%ROWTYPE;
  v_key text;
  v_allowed constant text[] := ARRAY[
    'title', 'description', 'event_date', 'start_time', 'end_time', 'volunteers_needed',
    'requirements', 'location', 'contact_person', 'contact_phone'
  ];
  v_today date := (now() AT TIME ZONE 'Europe/Zagreb')::date;
  v_title text;
  v_description text;
  v_event_date date;
  v_start time;
  v_end time;
  v_needed integer;
  v_requirements text;
  v_location text;
  v_contact_person text;
  v_contact_phone text;
  v_active integer;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch must be an object' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'field % cannot be changed', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT e.* INTO v_event FROM public.volunteer_events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'P0002';
  END IF;
  v_before := v_event;

  SELECT p.* INTO v_profile FROM public.profiles p WHERE p.id = p_actor_id;
  IF NOT FOUND OR v_profile.role <> 'ngo' OR v_profile.institution_id IS NULL
     OR v_profile.institution_id <> v_event.institution_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_event.event_date < v_today THEN
    RAISE EXCEPTION 'event has ended' USING ERRCODE = '23514';
  END IF;

  v_title := CASE WHEN p_patch ? 'title'
    THEN public.patch_text_value(p_patch->'title', 'title', 1, 160, false) ELSE v_event.title END;
  v_description := CASE WHEN p_patch ? 'description'
    THEN public.patch_text_value(p_patch->'description', 'description', 1, 4000, true) ELSE v_event.description END;
  v_requirements := CASE WHEN p_patch ? 'requirements'
    THEN public.patch_text_value(p_patch->'requirements', 'requirements', 1, 2000, true) ELSE v_event.requirements END;
  v_location := CASE WHEN p_patch ? 'location'
    THEN public.patch_text_value(p_patch->'location', 'location', 1, 300, true) ELSE v_event.location END;
  v_contact_person := CASE WHEN p_patch ? 'contact_person'
    THEN public.patch_text_value(p_patch->'contact_person', 'contact_person', 1, 120, true) ELSE v_event.contact_person END;
  v_contact_phone := CASE WHEN p_patch ? 'contact_phone'
    THEN public.patch_text_value(p_patch->'contact_phone', 'contact_phone', 6, 40, true) ELSE v_event.contact_phone END;
  IF p_patch ? 'contact_phone' AND v_contact_phone IS NOT NULL
     AND v_contact_phone !~ '^[0-9 +()/.-]{6,40}$' THEN
    RAISE EXCEPTION 'contact_phone may contain only digits, spaces and + ( ) / - .' USING ERRCODE = '22023';
  END IF;

  v_event_date := v_event.event_date;
  IF p_patch ? 'event_date' THEN
    IF coalesce(p_patch->>'event_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'event_date must be a real YYYY-MM-DD date' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_event_date := (p_patch->>'event_date')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'event_date must be a real YYYY-MM-DD date' USING ERRCODE = '22023';
    END;
    IF v_event_date < v_today THEN
      RAISE EXCEPTION 'event_date cannot be in the past' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_start := v_event.start_time;
  IF p_patch ? 'start_time' THEN
    IF coalesce(p_patch->>'start_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'start_time must use HH:MM' USING ERRCODE = '22023';
    END IF;
    v_start := (p_patch->>'start_time')::time;
  END IF;
  v_end := v_event.end_time;
  IF p_patch ? 'end_time' THEN
    IF coalesce(p_patch->>'end_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'end_time must use HH:MM' USING ERRCODE = '22023';
    END IF;
    v_end := (p_patch->>'end_time')::time;
  END IF;
  IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end <= v_start THEN
    RAISE EXCEPTION 'end_time must be after start_time' USING ERRCODE = '22023';
  END IF;

  v_needed := v_event.volunteers_needed;
  IF p_patch ? 'volunteers_needed' THEN
    IF jsonb_typeof(p_patch->'volunteers_needed') <> 'number'
       OR (p_patch->>'volunteers_needed') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'volunteers_needed must be a whole number' USING ERRCODE = '22023';
    END IF;
    v_needed := (p_patch->>'volunteers_needed')::integer;
    IF v_needed < 1 OR v_needed > 10000 THEN
      RAISE EXCEPTION 'volunteers_needed must be between 1 and 10000' USING ERRCODE = '22023';
    END IF;
    SELECT count(*)::integer INTO v_active
    FROM public.volunteer_signups s
    WHERE s.event_id = v_event.id AND s.cancelled_at IS NULL;
    IF v_needed < v_active THEN
      RAISE EXCEPTION 'capacity below signups' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.volunteer_events e
  SET title = v_title,
      description = v_description,
      event_date = v_event_date,
      start_time = v_start,
      end_time = v_end,
      volunteers_needed = v_needed,
      requirements = v_requirements,
      location = v_location,
      contact_person = v_contact_person,
      contact_phone = v_contact_phone
  WHERE e.id = v_event.id
  RETURNING * INTO v_event;

  IF v_event.event_date IS DISTINCT FROM v_before.event_date
     OR v_event.start_time IS DISTINCT FROM v_before.start_time
     OR v_event.end_time IS DISTINCT FROM v_before.end_time
     OR v_event.location IS DISTINCT FROM v_before.location THEN
    -- A reminder already sent for the old date must not block the new one.
    IF v_event.event_date IS DISTINCT FROM v_before.event_date THEN
      UPDATE public.notifications n SET reminder_event_id = NULL WHERE n.reminder_event_id = v_event.id;
    END IF;

    INSERT INTO public.notifications (user_id, title, body, link)
    SELECT
      s.user_id,
      'Promjena volonterskog događaja',
      format(
        'Udruga je promijenila termin ili mjesto događaja "%s": %s, %s–%s%s.',
        v_event.title,
        to_char(v_event.event_date::timestamp, 'DD.MM.YYYY.'),
        substring(v_event.start_time::text, 1, 5),
        substring(v_event.end_time::text, 1, 5),
        CASE WHEN v_event.location IS NOT NULL THEN ', ' || v_event.location ELSE '' END
      ),
      '/dashboard/individual'
    FROM public.volunteer_signups s
    WHERE s.event_id = v_event.id AND s.cancelled_at IS NULL;
  END IF;

  PERFORM public.append_audit_log_event(
    p_actor_id,
    NULL,
    'volunteer_event.update',
    'volunteer_event',
    v_event.id,
    jsonb_build_object(
      'institution_id', v_event.institution_id,
      'fields', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_patch) AS k)
    )
  );

  RETURN to_jsonb(v_event);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_volunteer_event_transaction(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_volunteer_event_transaction(uuid, uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Per-account limits
-- ---------------------------------------------------------------------------

-- Pledges and signups are promises nobody approves (invariant 6), so a single
-- free account must not be able to cover every need or fill every event.
CREATE OR REPLACE FUNCTION public.enforce_pledge_account_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF (
    SELECT count(*) FROM public.pledges p
    WHERE p.user_id = NEW.user_id AND p.created_at > now() - interval '24 hours'
  ) >= 10 THEN
    RAISE EXCEPTION 'too many pledges today' USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT count(*) FROM public.pledges p
    WHERE p.user_id = NEW.user_id AND p.cancelled_at IS NULL
  ) >= 25 THEN
    RAISE EXCEPTION 'too many active pledges' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_pledge_account_limits() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pledges_account_limits ON public.pledges;
CREATE TRIGGER pledges_account_limits
  BEFORE INSERT ON public.pledges
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pledge_account_limits();

CREATE OR REPLACE FUNCTION public.enforce_signup_account_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  -- Inserts, and reactivations of a withdrawn signup.
  IF TG_OP = 'UPDATE' AND NOT (OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NULL) THEN
    RETURN NEW;
  END IF;
  IF (
    SELECT count(*) FROM public.volunteer_signups s
    WHERE s.user_id = NEW.user_id AND s.created_at > now() - interval '24 hours'
      AND s.id IS DISTINCT FROM NEW.id
  ) >= 10 THEN
    RAISE EXCEPTION 'too many signups today' USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT count(*)
    FROM public.volunteer_signups s
    JOIN public.volunteer_events e ON e.id = s.event_id
    WHERE s.user_id = NEW.user_id AND s.cancelled_at IS NULL
      AND e.event_date >= (now() AT TIME ZONE 'Europe/Zagreb')::date
      AND s.id IS DISTINCT FROM NEW.id
  ) >= 25 THEN
    RAISE EXCEPTION 'too many active signups' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_signup_account_limits() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS volunteer_signups_account_limits ON public.volunteer_signups;
CREATE TRIGGER volunteer_signups_account_limits
  BEFORE INSERT OR UPDATE OF cancelled_at ON public.volunteer_signups
  FOR EACH ROW EXECUTE FUNCTION public.enforce_signup_account_limits();

-- ---------------------------------------------------------------------------
-- 4. Reminders on the Croatian calendar
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_volunteer_event_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  WHERE e.event_date = (now() AT TIME ZONE 'Europe/Zagreb')::date + 1
  ON CONFLICT (reminder_event_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Same reminders, returning only the recipients whose reminder row is new, so
-- the cron route can e-mail each of them exactly once however often it runs.
CREATE OR REPLACE FUNCTION public.send_volunteer_event_reminders_with_recipients()
RETURNS TABLE(
  user_id uuid,
  email text,
  name text,
  event_id uuid,
  title text,
  event_date date,
  start_time time without time zone,
  end_time time without time zone,
  location text,
  institution_name text,
  institution_address text,
  contact_person text,
  contact_phone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH inserted AS (
    INSERT INTO public.notifications AS n (user_id, title, body, link, reminder_event_id)
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
    WHERE e.event_date = (now() AT TIME ZONE 'Europe/Zagreb')::date + 1
    ON CONFLICT (reminder_event_id, user_id) DO NOTHING
    RETURNING n.user_id AS recipient_id, n.reminder_event_id AS reminded_event_id
  )
  SELECT
    i.recipient_id,
    p.email,
    p.name,
    e.id,
    e.title,
    e.event_date,
    e.start_time,
    e.end_time,
    e.location,
    inst.name,
    inst.public_address,
    e.contact_person,
    e.contact_phone
  FROM inserted i
  JOIN public.profiles p ON p.id = i.recipient_id
  JOIN public.volunteer_events e ON e.id = i.reminded_event_id
  JOIN public.institutions inst ON inst.id = e.institution_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.send_volunteer_event_reminders_with_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_volunteer_event_reminders_with_recipients() TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Security audit residuals (2026-09-26)
-- ---------------------------------------------------------------------------

-- Staff access to pledges requires the ngo role; current_user_institution_id()
-- checks it. The old policy trusted any profile carrying an institution_id.
DROP POLICY IF EXISTS "Institutions can view pledges for their needs" ON public.pledges;
DROP POLICY IF EXISTS "Linked NGO reads pledges for own needs" ON public.pledges;
CREATE POLICY "Linked NGO reads pledges for own needs" ON public.pledges
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.needs n
    WHERE n.id = pledges.need_id
      AND n.institution_id = public.current_user_institution_id()
  ));

-- Bound what user tokens can still write (mirrors src/lib/validation.ts).
ALTER TABLE public.needs
  ADD CONSTRAINT needs_title_length CHECK (char_length(title) BETWEEN 1 AND 160),
  ADD CONSTRAINT needs_description_length CHECK (description IS NULL OR char_length(description) <= 4000);
ALTER TABLE public.volunteer_events
  ADD CONSTRAINT volunteer_events_title_length CHECK (char_length(title) BETWEEN 1 AND 160),
  ADD CONSTRAINT volunteer_events_text_lengths CHECK (
        (description IS NULL OR char_length(description) <= 4000)
    AND (requirements IS NULL OR char_length(requirements) <= 2000)
    AND (contact_person IS NULL OR char_length(contact_person) <= 200)
    AND (contact_phone IS NULL OR char_length(contact_phone) <= 50));
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_text_lengths CHECK (
        char_length(name) <= 200
    AND (neighborhood IS NULL OR char_length(neighborhood) <= 120)
    AND (contact_person IS NULL OR char_length(contact_person) <= 200)
    AND (interests IS NULL OR cardinality(interests) <= 20)
    AND (locale IS NULL OR locale IN ('hr', 'en')));
ALTER TABLE public.institutions
  ADD CONSTRAINT institutions_presentational_lengths CHECK (
        char_length(coalesce(description, '')) <= 4000
    AND (phone IS NULL OR char_length(phone) <= 50)
    AND (email IS NULL OR char_length(email) <= 254)
    AND (website IS NULL OR char_length(website) <= 500)
    AND (working_hours IS NULL OR char_length(working_hours) <= 500)
    AND (drop_off_hours IS NULL OR char_length(drop_off_hours) <= 500));

-- Notification policy hygiene (inert today because of grants).
DROP POLICY IF EXISTS "Service can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
ALTER POLICY "Users can view own notifications" ON public.notifications TO authenticated;
ALTER POLICY "Users can update own notifications" ON public.notifications
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Verbs RLS does not govern.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.audit_log, public.institutions, public.needs, public.ngo_registry,
  public.notifications, public.pledges, public.profiles, public.volunteer_events,
  public.volunteer_signups, public.institution_claims
FROM PUBLIC, anon, authenticated;
