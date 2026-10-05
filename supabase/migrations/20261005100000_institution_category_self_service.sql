-- An organisation chooses its own category, or asks for its own type.
--
-- Organisations said the twelve social categories do not describe all of
-- them, and that only the claim reviewer could set the one they got.
--
-- 1. update_own_institution_profile also accepts `category`: one of the
--    social categories except `domestic_violence`. Violence-support
--    organisations are never pinned at their seat (PROTECTED_LOCATION_
--    CATEGORIES in src/lib/location-map.ts), so moving into or out of that
--    category stays an administrator's decision; an organisation already in
--    it cannot change its category here. The new category is also written
--    to the published directory row, which is what the map and the engaged
--    directory read. Choosing a listed category clears an approved custom
--    type and withdraws an open request for one.
-- 2. institutions.category_label is an organisation's own name for its type
--    ("Dnevni boravak za osobe s demencijom"), shown on its public profile in
--    place of the category's name. The category still decides filters and
--    the pin. A label is never published from typed input alone:
--    request_institution_category_label queues it in
--    institution_category_requests and notifies the administrators, and
--    review_institution_category_request approves it (with the category the
--    reviewer picks for filtering) or rejects it, notifying the
--    organisation either way.
-- 3. public_institution_detail_v1 also returns category_label, as its last
--    column. Its result type changes, so it is dropped and recreated inside
--    this transaction; the application reads the column as optional.
--
-- All new functions are service_role only; the routes resolve the actor with
-- auth.getUser() and the functions decide ownership and the reviewer role
-- themselves. Apply before deploying the application change, then refresh
-- the Data API schema.

BEGIN;

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS category_label text;

ALTER TABLE public.institutions
  DROP CONSTRAINT IF EXISTS institutions_category_label_length;
ALTER TABLE public.institutions
  ADD CONSTRAINT institutions_category_label_length
  CHECK (category_label IS NULL OR char_length(category_label) BETWEEN 2 AND 80);

REVOKE UPDATE (category_label) ON public.institutions FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.institution_category_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 80),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_category text,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One open request per organisation; a new one replaces its text.
CREATE UNIQUE INDEX IF NOT EXISTS institution_category_requests_one_pending
  ON public.institution_category_requests (institution_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS institution_category_requests_pending_created
  ON public.institution_category_requests (created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS institution_category_requests_institution_created
  ON public.institution_category_requests (institution_id, created_at DESC);

ALTER TABLE public.institution_category_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.institution_category_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.institution_category_requests TO service_role;
-- The organisation's dashboard reads its own requests; nothing else.
GRANT SELECT (id, institution_id, label, status, review_note, created_at, reviewed_at)
  ON public.institution_category_requests TO authenticated;

DROP POLICY IF EXISTS "Organisation accounts read their own category requests"
  ON public.institution_category_requests;
CREATE POLICY "Organisation accounts read their own category requests"
  ON public.institution_category_requests
  FOR SELECT
  TO authenticated
  USING (
    institution_id = (
      SELECT p.institution_id
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'ngo'
    )
  );

-- ---------------------------------------------------------------------------
-- 1. The profile edit, with `category`. Body otherwise unchanged from
--    20260926110000.

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
    'description', 'phone', 'email', 'website', 'working_hours', 'drop_off_hours', 'accepts_donations',
    'category'
  ];
  v_donation_types constant text[] := ARRAY[
    'clothes', 'food', 'hygiene', 'toys_books', 'school_supplies', 'furniture',
    'medical_supplies', 'baby_items', 'blankets_bedding', 'money', 'time'
  ];
  -- The social categories an organisation may choose for itself:
  -- SOCIAL_MAP_CATEGORIES in src/lib/location-map.ts without domestic_violence.
  v_self_categories constant text[] := ARRAY[
    'homeless_shelter', 'soup_kitchen', 'children_home', 'caritas',
    'disability_support', 'elderly_care', 'social_welfare',
    'student_housing', 'mental_health', 'refugee_migrant_support', 'medical_patient_support'
  ];
  v_description text;
  v_phone text;
  v_email text;
  v_website text;
  v_working_hours text;
  v_drop_off_hours text;
  v_accepts text[];
  v_category text;
  v_previous_category text;
  v_batch_id text;
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
  v_previous_category := v_institution.category;

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

  IF p_patch ? 'category' THEN
    v_category := public.patch_text_value(p_patch->'category', 'category', 1, 64, false);
    -- A violence-support organisation's location is protected; an
    -- administrator decides whether it leaves or enters that category.
    IF v_institution.category = 'domestic_violence' THEN
      RAISE EXCEPTION 'category of a violence-support organisation is changed by an administrator'
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_category = ANY (v_self_categories)) THEN
      RAISE EXCEPTION 'category must be one of the social categories' USING ERRCODE = '22023';
    END IF;
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
      END,
      category = CASE WHEN p_patch ? 'category' THEN v_category ELSE i.category END,
      -- A listed category replaces the organisation's own type.
      category_label = CASE WHEN p_patch ? 'category' THEN NULL ELSE i.category_label END
  WHERE i.id = v_institution.id
  RETURNING * INTO v_institution;

  IF p_patch ? 'category' THEN
    UPDATE public.institution_category_requests r
    SET status = 'withdrawn',
        updated_at = now()
    WHERE r.institution_id = v_institution.id AND r.status = 'pending';

    -- The map and the engaged directory read the published directory row;
    -- later snapshots take a linked institution's category on their own.
    IF v_category IS DISTINCT FROM v_previous_category THEN
      SELECT state.current_batch_id INTO v_batch_id
      FROM public.registry_publication_state state
      WHERE state.singleton = true;

      IF v_batch_id IS NOT NULL THEN
        UPDATE public.registry_directory_entries d
        SET category = v_category
        FROM public.ngo_registry r
        WHERE r.institution_id = v_institution.id
          AND d.batch_id = v_batch_id
          AND d.udr_id = r.udr_id;
      END IF;
    END IF;
  END IF;

  PERFORM public.append_audit_log_event(
    p_actor_id,
    NULL,
    'institution.profile_update',
    'institution',
    v_institution.id,
    jsonb_build_object('fields', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_patch) AS k))
      || CASE WHEN p_patch ? 'category'
           THEN jsonb_build_object('category_from', v_previous_category, 'category_to', v_category)
           ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object(
    'id', v_institution.id,
    'name', v_institution.name,
    'category', v_institution.category,
    'category_label', v_institution.category_label,
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

-- ---------------------------------------------------------------------------
-- 2. The organisation's own type, through review.

CREATE OR REPLACE FUNCTION public.request_institution_category_label(p_actor_id uuid, p_label text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_institution public.institutions%ROWTYPE;
  v_request public.institution_category_requests%ROWTYPE;
  v_label text := regexp_replace(btrim(coalesce(p_label, '')), '[[:space:]]+', ' ', 'g');
  v_created boolean := false;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_label) < 2 OR char_length(v_label) > 80 THEN
    RAISE EXCEPTION 'category_label must be 2-80 characters' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_profile FROM public.profiles p WHERE p.id = p_actor_id;
  IF NOT FOUND OR v_profile.role <> 'ngo' OR v_profile.institution_id IS NULL THEN
    RAISE EXCEPTION 'only a linked organisation account can request a type' USING ERRCODE = '42501';
  END IF;

  SELECT i.* INTO v_institution
  FROM public.institutions i
  WHERE i.id = v_profile.institution_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_institution.category = 'domestic_violence' THEN
    RAISE EXCEPTION 'category of a violence-support organisation is changed by an administrator'
      USING ERRCODE = '22023';
  END IF;

  -- Each request reaches every administrator; ten a day is plenty for an
  -- organisation correcting a typo.
  IF (
    SELECT count(*) FROM public.institution_category_requests r
    WHERE r.institution_id = v_institution.id AND r.created_at > now() - interval '24 hours'
  ) >= 10 THEN
    RAISE EXCEPTION 'too many category requests today' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.institution_category_requests r
  SET label = v_label,
      requested_by = p_actor_id,
      updated_at = now()
  WHERE r.institution_id = v_institution.id AND r.status = 'pending'
  RETURNING * INTO v_request;

  IF NOT FOUND THEN
    INSERT INTO public.institution_category_requests (institution_id, requested_by, label)
    VALUES (v_institution.id, p_actor_id, v_label)
    RETURNING * INTO v_request;
    v_created := true;
  END IF;

  -- The review queue has no other alert; a changed text of an open request
  -- is already in the queue.
  IF v_created THEN
    INSERT INTO public.notifications (user_id, title, body, link)
    SELECT
      p.id,
      'Nova vrsta udruge',
      left(v_institution.name, 200) || ' predlaže vrstu „' || v_label || '”.',
      '/dashboard/admin'
    FROM public.profiles p
    WHERE p.role = 'superadmin';
  END IF;

  PERFORM public.append_audit_log_event(
    p_actor_id,
    NULL,
    'institution_category.request',
    'institution',
    v_institution.id,
    jsonb_build_object('request_id', v_request.id, 'label', v_label)
  );

  RETURN jsonb_build_object(
    'id', v_request.id,
    'label', v_request.label,
    'status', v_request.status,
    'review_note', v_request.review_note,
    'created_at', v_request.created_at,
    'reviewed_at', v_request.reviewed_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.request_institution_category_label(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_institution_category_label(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.review_institution_category_request(
  p_reviewer_id uuid,
  p_request_id uuid,
  p_decision text,
  p_category text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_reviewer_role text;
  v_request public.institution_category_requests%ROWTYPE;
  v_institution public.institutions%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_previous_category text;
  v_batch_id text;
  v_social constant text[] := ARRAY[
    'homeless_shelter', 'soup_kitchen', 'children_home', 'caritas',
    'disability_support', 'domestic_violence', 'elderly_care', 'social_welfare',
    'student_housing', 'mental_health', 'refugee_migrant_support', 'medical_patient_support'
  ];
BEGIN
  IF p_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'decision must be approve or reject' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'review note is too long' USING ERRCODE = '22023';
  END IF;
  IF v_category IS NOT NULL AND NOT (v_category = ANY (v_social)) THEN
    RAISE EXCEPTION 'invalid category' USING ERRCODE = '22023';
  END IF;

  SELECT p.role INTO v_reviewer_role FROM public.profiles p WHERE p.id = p_reviewer_id;
  IF v_reviewer_role IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'reviewer is not an administrator' USING ERRCODE = '42501';
  END IF;

  SELECT r.* INTO v_request
  FROM public.institution_category_requests r
  WHERE r.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'request is no longer open' USING ERRCODE = 'P0001';
  END IF;

  SELECT i.* INTO v_institution
  FROM public.institutions i
  WHERE i.id = v_request.institution_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation not found' USING ERRCODE = 'P0002';
  END IF;
  v_previous_category := v_institution.category;

  IF p_decision = 'approve' THEN
    v_category := coalesce(v_category, v_institution.category);
    IF NOT (v_category = ANY (v_social)) THEN
      RAISE EXCEPTION 'choose a social category for this organisation' USING ERRCODE = '22023';
    END IF;
    -- Entering the violence-support category would have to hide the
    -- location of a pin already shown exactly; that is not done here.
    IF v_category = 'domestic_violence' AND v_previous_category <> 'domestic_violence' THEN
      RAISE EXCEPTION 'the violence-support category cannot be set from a type request'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.institutions i
    SET category = v_category,
        category_label = v_request.label
    WHERE i.id = v_institution.id
    RETURNING * INTO v_institution;

    IF v_category IS DISTINCT FROM v_previous_category THEN
      SELECT state.current_batch_id INTO v_batch_id
      FROM public.registry_publication_state state
      WHERE state.singleton = true;

      IF v_batch_id IS NOT NULL THEN
        UPDATE public.registry_directory_entries d
        SET category = v_category
        FROM public.ngo_registry r
        WHERE r.institution_id = v_institution.id
          AND d.batch_id = v_batch_id
          AND d.udr_id = r.udr_id;
      END IF;
    END IF;

    UPDATE public.institution_category_requests r
    SET status = 'approved',
        decided_category = v_category,
        review_note = v_note,
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        updated_at = now()
    WHERE r.id = v_request.id
    RETURNING * INTO v_request;

    INSERT INTO public.notifications (user_id, title, body, link)
    SELECT
      p.id,
      'Vrsta udruge je odobrena',
      'Na profilu udruge sada piše „' || v_request.label || '”.',
      '/dashboard/institution'
    FROM public.profiles p
    WHERE p.institution_id = v_institution.id AND p.role = 'ngo';
  ELSE
    UPDATE public.institution_category_requests r
    SET status = 'rejected',
        review_note = v_note,
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        updated_at = now()
    WHERE r.id = v_request.id
    RETURNING * INTO v_request;

    INSERT INTO public.notifications (user_id, title, body, link)
    SELECT
      p.id,
      'Vrsta udruge nije odobrena',
      'Prijedlog „' || v_request.label || '” nije odobren.'
        || coalesce(' Obrazloženje: ' || left(v_note, 400), ''),
      '/dashboard/institution'
    FROM public.profiles p
    WHERE p.institution_id = v_institution.id AND p.role = 'ngo';
  END IF;

  PERFORM public.append_audit_log_event(
    p_reviewer_id,
    NULL,
    'institution_category.' || p_decision,
    'institution',
    v_institution.id,
    jsonb_build_object(
      'request_id', v_request.id,
      'label', v_request.label,
      'category_from', v_previous_category,
      'category_to', v_institution.category,
      'review_note', v_note
    )
  );

  RETURN jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'label', v_request.label,
    'category', v_institution.category
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.review_institution_category_request(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_institution_category_request(uuid, uuid, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Public detail with the organisation's own type. Body unchanged from
--    20260801150000 apart from the trailing column.

DROP FUNCTION IF EXISTS public.public_institution_detail_v1(uuid);

CREATE FUNCTION public.public_institution_detail_v1(p_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  category text,
  description text,
  address text,
  city text,
  latitude double precision,
  longitude double precision,
  phone text,
  email text,
  website text,
  working_hours text,
  drop_off_hours text,
  accepts_donations text[],
  capacity text,
  served_population text,
  photo_url text,
  is_verified boolean,
  is_location_hidden boolean,
  approximate_area text,
  nearest_zet_stop text,
  zet_lines text,
  source text,
  created_at timestamptz,
  updated_at timestamptz,
  category_label text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    i.id,
    i.name,
    i.category,
    i.description,
    CASE WHEN i.is_location_hidden THEN NULL ELSE i.address END,
    i.city,
    i.public_lat,
    i.public_lng,
    i.phone,
    i.email,
    i.website,
    i.working_hours,
    i.drop_off_hours,
    coalesce(i.accepts_donations, ARRAY[]::text[]),
    i.capacity,
    i.served_population,
    i.photo_url,
    coalesce(i.is_verified, false),
    coalesce(i.is_location_hidden, false),
    i.approximate_area,
    i.nearest_zet_stop,
    i.zet_lines,
    i.source,
    i.created_at,
    i.updated_at,
    i.category_label
  FROM public.institutions i
  WHERE i.id = p_id;
$$;

REVOKE ALL ON FUNCTION public.public_institution_detail_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_institution_detail_v1(uuid)
  TO anon, authenticated, service_role;

COMMIT;
