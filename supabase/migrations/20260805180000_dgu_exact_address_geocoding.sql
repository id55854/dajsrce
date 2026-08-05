-- Authoritative building coordinates for the active association registry.
--
-- Croatia's State Geodetic Administration (DGU) publishes INSPIRE address
-- points under the national Open Data Licence. Matches are staged, applied in
-- bounded batches, and retain the DGU address identifier and dataset date for
-- auditability. Only unambiguous house-number matches are marked exact.

BEGIN;

ALTER TABLE public.ngo_registry
  ADD COLUMN IF NOT EXISTS geocode_address_id text,
  ADD COLUMN IF NOT EXISTS geocode_matched_address text,
  ADD COLUMN IF NOT EXISTS geocode_match_method text,
  ADD COLUMN IF NOT EXISTS geocode_dataset_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS geocode_batch_id text;

CREATE INDEX IF NOT EXISTS idx_ngo_registry_dgu_exact
  ON public.ngo_registry (geocode_batch_id, udr_id)
  WHERE geocode_source = 'dgu_inspire_addresses'
    AND geocode_confidence = 'exact';

CREATE TABLE IF NOT EXISTS public.registry_geocode_batches (
  id text PRIMARY KEY,
  provider text NOT NULL CHECK (provider = 'dgu_inspire_addresses'),
  dataset_url text NOT NULL,
  dataset_updated_at timestamptz NOT NULL,
  source_archive_sha256 text NOT NULL
    CHECK (source_archive_sha256 ~ '^[0-9a-f]{64}$'),
  expected_rows integer CHECK (expected_rows > 0),
  staged_rows integer NOT NULL DEFAULT 0 CHECK (staged_rows >= 0),
  applied_rows integer NOT NULL DEFAULT 0 CHECK (applied_rows >= 0),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.registry_dgu_geocode_staging (
  batch_id text NOT NULL
    REFERENCES public.registry_geocode_batches(id) ON DELETE CASCADE,
  udr_id text NOT NULL REFERENCES public.ngo_registry(udr_id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK (latitude BETWEEN 42 AND 47),
  longitude double precision NOT NULL CHECK (longitude BETWEEN 13 AND 20),
  dgu_address_id text NOT NULL CHECK (char_length(dgu_address_id) BETWEEN 3 AND 80),
  matched_address text NOT NULL CHECK (char_length(matched_address) BETWEEN 3 AND 500),
  match_method text NOT NULL CHECK (char_length(match_method) BETWEEN 3 AND 80),
  staged_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  PRIMARY KEY (batch_id, udr_id)
);

CREATE INDEX IF NOT EXISTS idx_registry_dgu_geocode_staging_pending
  ON public.registry_dgu_geocode_staging (batch_id, udr_id)
  WHERE applied_at IS NULL;

ALTER TABLE public.registry_geocode_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registry_dgu_geocode_staging ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registry_geocode_batches, public.registry_dgu_geocode_staging
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.registry_geocode_batches, public.registry_dgu_geocode_staging
  TO service_role;

-- Existing geocodes must never survive a changed official headquarters
-- address. The next DGU pass will either find the new building or leave the
-- record honestly approximate.
CREATE OR REPLACE FUNCTION public.invalidate_registry_geocode_on_address_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.sjediste IS DISTINCT FROM NEW.sjediste THEN
    NEW.lat := NULL;
    NEW.lng := NULL;
    NEW.geocode_source := NULL;
    NEW.geocode_confidence := NULL;
    NEW.geocoded_at := NULL;
    NEW.geocode_status := 'pending';
    NEW.next_geocode_attempt_at := NULL;
    NEW.last_geocode_error := NULL;
    NEW.geocode_address_id := NULL;
    NEW.geocode_matched_address := NULL;
    NEW.geocode_match_method := NULL;
    NEW.geocode_dataset_updated_at := NULL;
    NEW.geocode_batch_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_registry_geocode_on_address_change_trigger
  ON public.ngo_registry;
CREATE TRIGGER invalidate_registry_geocode_on_address_change_trigger
  BEFORE UPDATE OF sjediste ON public.ngo_registry
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_registry_geocode_on_address_change();

REVOKE ALL ON FUNCTION public.invalidate_registry_geocode_on_address_change()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invalidate_registry_geocode_on_address_change()
  TO service_role;

-- Prefer linked curated/claimed locations, then authoritative DGU points.
-- Registry-owned linked institutions use the DGU result only after the same
-- canonical registry row has an exact match. Hidden locations remain jittered
-- through institutions.public_lat/public_lng.
CREATE OR REPLACE FUNCTION public.registry_public_map_point(
  p_udr_id text,
  p_city text,
  p_county text,
  p_lat double precision,
  p_lng double precision,
  p_institution_id uuid DEFAULT NULL
)
RETURNS TABLE (
  latitude double precision,
  longitude double precision,
  location_precision text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lat double precision;
  v_lng double precision;
  v_precision text;
  v_lat_radius double precision;
  v_lng_radius double precision;
  v_lat_fraction double precision;
  v_lng_fraction double precision;
  v_has_dgu_exact boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.ngo_registry r
    WHERE r.udr_id = p_udr_id
      AND r.geocode_source = 'dgu_inspire_addresses'
      AND r.geocode_confidence = 'exact'
      AND r.lat BETWEEN 42 AND 47
      AND r.lng BETWEEN 13 AND 20
  ) INTO v_has_dgu_exact;

  IF p_institution_id IS NOT NULL THEN
    SELECT i.public_lat, i.public_lng,
      CASE WHEN coalesce(i.is_location_hidden, false) THEN 'hidden' ELSE 'exact' END
    INTO v_lat, v_lng, v_precision
    FROM public.institutions i
    WHERE i.id = p_institution_id
      AND i.public_lat BETWEEN 42 AND 47
      AND i.public_lng BETWEEN 13 AND 20
      AND (i.source <> 'registry' OR v_has_dgu_exact);

    IF FOUND THEN
      RETURN QUERY SELECT v_lat, v_lng, v_precision;
      RETURN;
    END IF;
  END IF;

  IF v_has_dgu_exact AND p_lat BETWEEN 42 AND 47 AND p_lng BETWEEN 13 AND 20 THEN
    RETURN QUERY SELECT p_lat, p_lng, 'exact'::text;
    RETURN;
  END IF;

  IF p_lat BETWEEN 42 AND 47 AND p_lng BETWEEN 13 AND 20 THEN
    v_lat := p_lat;
    v_lng := p_lng;
    v_precision := 'city';
    v_lat_radius := 0.012;
    v_lng_radius := 0.018;
  ELSE
    SELECT c.latitude, c.longitude
    INTO v_lat, v_lng
    FROM public.registry_location_centroids c
    WHERE c.county_key = public.registry_location_key(p_county)
      AND c.city_key = public.registry_location_key(p_city);

    IF FOUND THEN
      v_precision := 'city';
      v_lat_radius := 0.025;
      v_lng_radius := 0.040;
    ELSE
      SELECT c.latitude, c.longitude
      INTO v_lat, v_lng
      FROM public.registry_location_centroids c
      WHERE c.county_key = public.registry_location_key(p_county)
        AND c.city_key = '';
      v_precision := 'county';
      v_lat_radius := 0.120;
      v_lng_radius := 0.180;
    END IF;
  END IF;

  IF v_lat IS NULL OR v_lng IS NULL THEN
    v_lat := 45.20;
    v_lng := 16.40;
    v_precision := 'county';
    v_lat_radius := 0.350;
    v_lng_radius := 0.500;
  END IF;

  v_lat_fraction := ((hashtextextended(coalesce(p_udr_id, '') || ':lat', 0) & 2147483647)::double precision / 2147483647.0) - 0.5;
  v_lng_fraction := ((hashtextextended(coalesce(p_udr_id, '') || ':lng', 0) & 2147483647)::double precision / 2147483647.0) - 0.5;

  RETURN QUERY SELECT
    greatest(42.0, least(47.0, v_lat + v_lat_fraction * 2 * v_lat_radius)),
    greatest(13.0, least(20.0, v_lng + v_lng_fraction * 2 * v_lng_radius)),
    v_precision;
END;
$$;

REVOKE ALL ON FUNCTION public.registry_public_map_point(
  text, text, text, double precision, double precision, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registry_public_map_point(
  text, text, text, double precision, double precision, uuid
) TO service_role;

-- Apply at most 500 staged points per transaction. This keeps the free-tier
-- database responsive and makes interrupted imports safely resumable.
CREATE OR REPLACE FUNCTION public.apply_registry_dgu_geocode_batch(
  p_batch_id text,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_ids text[];
  v_selected integer := 0;
  v_updated integer := 0;
  v_remaining integer := 0;
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'DGU apply limit must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.registry_geocode_batches
    WHERE id = p_batch_id AND status = 'running'
  ) THEN
    RAISE EXCEPTION 'running DGU geocode batch not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(array_agg(picked.udr_id ORDER BY picked.udr_id), ARRAY[]::text[])
  INTO v_ids
  FROM (
    SELECT s.udr_id
    FROM public.registry_dgu_geocode_staging s
    WHERE s.batch_id = p_batch_id AND s.applied_at IS NULL
    ORDER BY s.udr_id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ) picked;
  v_selected := cardinality(v_ids);

  IF v_selected = 0 THEN
    SELECT count(*) INTO v_remaining
    FROM public.registry_dgu_geocode_staging
    WHERE batch_id = p_batch_id AND applied_at IS NULL;
    RETURN jsonb_build_object('applied', 0, 'remaining', v_remaining);
  END IF;

  UPDATE public.ngo_registry r
  SET lat = s.latitude,
      lng = s.longitude,
      geocode_source = 'dgu_inspire_addresses',
      geocode_confidence = 'exact',
      geocoded_at = now(),
      geocode_status = 'succeeded',
      next_geocode_attempt_at = NULL,
      last_geocode_error = NULL,
      geocode_address_id = s.dgu_address_id,
      geocode_matched_address = s.matched_address,
      geocode_match_method = s.match_method,
      geocode_dataset_updated_at = b.dataset_updated_at,
      geocode_batch_id = p_batch_id
  FROM public.registry_dgu_geocode_staging s
  JOIN public.registry_geocode_batches b ON b.id = s.batch_id
  JOIN public.registry_publication_state state ON state.singleton = true
  JOIN public.registry_directory_entries d
    ON d.batch_id = state.current_batch_id AND d.udr_id = s.udr_id
  WHERE s.batch_id = p_batch_id
    AND s.udr_id = ANY(v_ids)
    AND r.udr_id = s.udr_id
    AND r.status = 'AKTIVAN';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> v_selected THEN
    RAISE EXCEPTION 'DGU batch contains non-current rows: selected %, current %',
      v_selected, v_updated USING ERRCODE = 'P0001';
  END IF;

  -- Registry-created institution rows are mirrors of the same official entity.
  -- The existing location trigger derives either the exact public point or a
  -- privacy-safe hidden point.
  UPDATE public.institutions i
  SET lat = s.latitude,
      lng = s.longitude
  FROM public.ngo_registry r
  JOIN public.registry_dgu_geocode_staging s
    ON s.udr_id = r.udr_id AND s.batch_id = p_batch_id
  WHERE s.udr_id = ANY(v_ids)
    AND i.id = r.institution_id
    AND i.source = 'registry';

  UPDATE public.registry_directory_entries directory
  SET institution_id = r.institution_id,
      map_lat = point.latitude,
      map_lng = point.longitude,
      map_precision = point.location_precision,
      map_location = extensions.st_setsrid(
        extensions.st_makepoint(point.longitude, point.latitude), 4326
      )::extensions.geography
  FROM public.registry_publication_state state
  JOIN public.ngo_registry r ON r.udr_id = ANY(v_ids)
  CROSS JOIN LATERAL public.registry_public_map_point(
    r.udr_id, r.city, r.zupanija, r.lat, r.lng, r.institution_id
  ) point
  WHERE state.singleton = true
    AND directory.batch_id = state.current_batch_id
    AND directory.udr_id = r.udr_id;

  UPDATE public.registry_dgu_geocode_staging
  SET applied_at = now()
  WHERE batch_id = p_batch_id AND udr_id = ANY(v_ids);

  SELECT count(*) INTO v_remaining
  FROM public.registry_dgu_geocode_staging
  WHERE batch_id = p_batch_id AND applied_at IS NULL;

  UPDATE public.registry_geocode_batches b
  SET staged_rows = counts.staged,
      applied_rows = counts.applied,
      updated_at = now()
  FROM (
    SELECT count(*)::integer AS staged,
           count(*) FILTER (WHERE applied_at IS NOT NULL)::integer AS applied
    FROM public.registry_dgu_geocode_staging
    WHERE batch_id = p_batch_id
  ) counts
  WHERE b.id = p_batch_id;

  RETURN jsonb_build_object('applied', v_selected, 'remaining', v_remaining);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_registry_dgu_geocode_batch(
  p_batch_id text,
  p_expected_rows integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_staged integer;
  v_applied integer;
  v_exact integer;
BEGIN
  IF p_expected_rows < 1 THEN
    RAISE EXCEPTION 'expected DGU row count must be positive' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.registry_geocode_batches
  WHERE id = p_batch_id AND status = 'running'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'running DGU geocode batch not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE applied_at IS NOT NULL)::integer
  INTO v_staged, v_applied
  FROM public.registry_dgu_geocode_staging
  WHERE batch_id = p_batch_id;

  IF v_staged <> p_expected_rows OR v_applied <> p_expected_rows THEN
    RAISE EXCEPTION 'incomplete DGU batch: staged %, applied %, expected %',
      v_staged, v_applied, p_expected_rows USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_exact
  FROM public.ngo_registry
  WHERE geocode_batch_id = p_batch_id
    AND geocode_source = 'dgu_inspire_addresses'
    AND geocode_confidence = 'exact';
  IF v_exact <> p_expected_rows THEN
    RAISE EXCEPTION 'canonical DGU count mismatch: exact %, expected %',
      v_exact, p_expected_rows USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.registry_geocode_batches
  SET expected_rows = p_expected_rows,
      staged_rows = v_staged,
      applied_rows = v_applied,
      status = 'completed',
      completed_at = now(),
      updated_at = now(),
      error = NULL
  WHERE id = p_batch_id;

  DELETE FROM public.registry_dgu_geocode_staging WHERE batch_id = p_batch_id;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'exact_building_points', v_exact,
    'status', 'completed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_registry_dgu_geocode_batch(text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_registry_dgu_geocode_batch(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_registry_dgu_geocode_batch(text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_registry_dgu_geocode_batch(text, integer)
  TO service_role;

-- v2 enriches exact registry features with their public official street
-- address while retaining the bounded clustering implementation from v1.
CREATE OR REPLACE FUNCTION public.map_association_registry_v2(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_zoom integer,
  p_categories text[] DEFAULT ARRAY[]::text[],
  p_donation_type text DEFAULT NULL,
  p_only_zagreb boolean DEFAULT false,
  p_only_urgent boolean DEFAULT false,
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 150
)
RETURNS TABLE (
  feature_kind text,
  feature_id text,
  institution_id uuid,
  registry_id text,
  entity_type text,
  name text,
  category text,
  city text,
  address text,
  approximate_area text,
  location_precision text,
  latitude double precision,
  longitude double precision,
  accepts_donations text[],
  is_verified boolean,
  is_location_hidden boolean,
  source text,
  has_urgent_need boolean,
  member_count bigint,
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  total_matches bigint,
  total_features bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT
    feature.feature_kind,
    feature.feature_id,
    feature.institution_id,
    feature.registry_id,
    feature.entity_type,
    feature.name,
    feature.category,
    feature.city,
    CASE
      WHEN feature.feature_kind = 'institution'
        AND feature.location_precision = 'exact'
        AND feature.registry_id IS NOT NULL
        THEN coalesce(feature.address, directory.address)
      ELSE feature.address
    END AS address,
    CASE
      WHEN feature.feature_kind = 'institution'
        AND feature.location_precision = 'exact'
        AND feature.registry_id IS NOT NULL
        THEN NULL
      ELSE feature.approximate_area
    END AS approximate_area,
    feature.location_precision,
    feature.latitude,
    feature.longitude,
    feature.accepts_donations,
    feature.is_verified,
    feature.is_location_hidden,
    feature.source,
    feature.has_urgent_need,
    feature.member_count,
    feature.min_lng,
    feature.min_lat,
    feature.max_lng,
    feature.max_lat,
    feature.total_matches,
    feature.total_features
  FROM public.map_association_registry_v1(
    p_min_lng, p_min_lat, p_max_lng, p_max_lat, p_zoom, p_categories,
    p_donation_type, p_only_zagreb, p_only_urgent, p_query, p_limit
  ) feature
  LEFT JOIN public.registry_publication_state state ON state.singleton = true
  LEFT JOIN public.registry_directory_entries directory
    ON directory.batch_id = state.current_batch_id
   AND directory.udr_id = feature.registry_id;
$$;

REVOKE ALL ON FUNCTION public.map_association_registry_v2(
  double precision, double precision, double precision, double precision,
  integer, text[], text, boolean, boolean, text, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_association_registry_v2(
  double precision, double precision, double precision, double precision,
  integer, text[], text, boolean, boolean, text, integer
) TO anon, authenticated, service_role;

COMMIT;
