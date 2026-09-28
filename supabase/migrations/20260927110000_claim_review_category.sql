-- A claim review decides the organisation's category.
--
-- Approval copied the published directory category: Jev's answer, or the
-- `association` catch-all when Jev did not place the organisation among the
-- twelve social categories or was not confident enough (542 rows wait in
-- registry_review_queue, and Jev misses some social associations outright).
-- Public listings show social associations only (20260927100000), so an
-- approved organisation left in `association` was invisible on the map and
-- in the engaged directory, and the review queue never showed the category,
-- so the reviewer could neither see nor prevent it.
--
-- 1. list_institution_claims_for_review also returns the directory category,
--    the register's classification status and, for a row Jev left for
--    review, its low-confidence suggestion.
-- 2. approve_institution_claim_transaction takes an optional p_category, one
--    of the twelve social categories, which wins over the register's.
--    Without it the register's category is used only when it is social;
--    otherwise the approval is refused ('choose a social category'), so a
--    reviewed account is never published invisible. The category is recorded
--    in the audit event and returned. A claimed institution keeps its
--    category through later syncs and reclassifications
--    (capture_registry_snapshot_membership and apply_registry_classifications
--    both defer to a linked institution), so the decision sticks.
--
-- The three-argument signature is replaced by one with p_category DEFAULT
-- NULL inside one transaction, so the deployed application's three named
-- arguments keep resolving. Bodies are the live ones from 2026-09-27 with
-- only those changes.

BEGIN;

DROP FUNCTION IF EXISTS public.approve_institution_claim_transaction(uuid, uuid, text);

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

REVOKE ALL ON FUNCTION public.approve_institution_claim_transaction(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_institution_claim_transaction(uuid, uuid, text, text) TO service_role;

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
            AND NOT public.institution_is_adoptable(d.institution_id),
          -- What approval would publish, and the classifier's standing, so
          -- the reviewer can choose a category (20260927110000).
          'category', d.category,
          'classification_status', r.classification_status,
          'suggested_category', CASE
            WHEN r.classification_status = 'needs_review' THEN r.mapped_category
          END
        ) END
      ) AS item
    FROM public.institution_claims c
    JOIN public.profiles p ON p.id = c.profile_id
    LEFT JOIN public.registry_directory_entries d
      ON d.batch_id = v_batch_id AND d.udr_id = c.udr_id
    LEFT JOIN public.ngo_registry r ON r.udr_id = c.udr_id
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

REVOKE ALL ON FUNCTION public.list_institution_claims_for_review(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_institution_claims_for_review(uuid, text, integer) TO service_role;

COMMIT;
