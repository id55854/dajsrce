-- Represent every organisation in the published active registry on the map.
-- Exact/public locations remain authoritative for linked institutions. Registry-
-- only rows use stable, explicitly approximate points so the public API never
-- invents an exact address coordinate. Large result sets are returned as a
-- bounded grid whose member counts still account for every matching row.

BEGIN;

CREATE TABLE IF NOT EXISTS public.registry_location_centroids (
  county_key text NOT NULL,
  city_key text NOT NULL DEFAULT '',
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  sample_count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (county_key, city_key),
  CHECK (latitude BETWEEN 42 AND 47),
  CHECK (longitude BETWEEN 13 AND 20),
  CHECK (sample_count > 0)
);

ALTER TABLE public.registry_location_centroids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registry_location_centroids FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.registry_location_centroids TO service_role;

CREATE OR REPLACE FUNCTION public.registry_location_key(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT lower(regexp_replace(btrim(coalesce(p_value, '')), '[^[:alnum:]]+', '', 'g'));
$$;

REVOKE ALL ON FUNCTION public.registry_location_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registry_location_key(text) TO service_role;

-- City and county medians are resistant to the occasional bad geocoder result.
-- A city key of '' is the county-level fallback.
INSERT INTO public.registry_location_centroids(
  county_key, city_key, latitude, longitude, sample_count, updated_at
)
SELECT
  public.registry_location_key(r.zupanija),
  public.registry_location_key(r.city),
  percentile_cont(0.5) WITHIN GROUP (ORDER BY r.lat),
  percentile_cont(0.5) WITHIN GROUP (ORDER BY r.lng),
  count(*)::integer,
  now()
FROM public.registry_publication_state state
JOIN public.registry_directory_entries directory
  ON directory.batch_id = state.current_batch_id
JOIN public.ngo_registry r ON r.udr_id = directory.udr_id
WHERE state.singleton = true
  AND r.lat BETWEEN 42 AND 47
  AND r.lng BETWEEN 13 AND 20
  AND public.registry_location_key(r.zupanija) <> ''
  AND public.registry_location_key(r.city) <> ''
GROUP BY public.registry_location_key(r.zupanija), public.registry_location_key(r.city)
ON CONFLICT (county_key, city_key) DO UPDATE SET
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  sample_count = EXCLUDED.sample_count,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.registry_location_centroids(
  county_key, city_key, latitude, longitude, sample_count, updated_at
)
SELECT
  public.registry_location_key(r.zupanija),
  '',
  percentile_cont(0.5) WITHIN GROUP (ORDER BY r.lat),
  percentile_cont(0.5) WITHIN GROUP (ORDER BY r.lng),
  count(*)::integer,
  now()
FROM public.registry_publication_state state
JOIN public.registry_directory_entries directory
  ON directory.batch_id = state.current_batch_id
JOIN public.ngo_registry r ON r.udr_id = directory.udr_id
WHERE state.singleton = true
  AND r.lat BETWEEN 42 AND 47
  AND r.lng BETWEEN 13 AND 20
  AND public.registry_location_key(r.zupanija) <> ''
GROUP BY public.registry_location_key(r.zupanija)
ON CONFLICT (county_key, city_key) DO UPDATE SET
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  sample_count = EXCLUDED.sample_count,
  updated_at = EXCLUDED.updated_at;

ALTER TABLE public.registry_directory_entries
  ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'association',
  ADD COLUMN IF NOT EXISTS map_lat double precision,
  ADD COLUMN IF NOT EXISTS map_lng double precision,
  ADD COLUMN IF NOT EXISTS map_precision text,
  ADD COLUMN IF NOT EXISTS map_location extensions.geography(Point, 4326);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registry_directory_map_precision_known'
  ) THEN
    ALTER TABLE public.registry_directory_entries
      ADD CONSTRAINT registry_directory_map_precision_known
      CHECK (map_precision IN ('exact', 'hidden', 'city', 'county') OR map_precision IS NULL);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_registry_directory_entries_map_location
  ON public.registry_directory_entries USING gist (map_location);
CREATE INDEX IF NOT EXISTS idx_registry_directory_entries_batch_category
  ON public.registry_directory_entries (batch_id, category);
CREATE INDEX IF NOT EXISTS idx_registry_directory_entries_institution
  ON public.registry_directory_entries (institution_id)
  WHERE institution_id IS NOT NULL;

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
BEGIN
  IF p_institution_id IS NOT NULL THEN
    SELECT i.public_lat, i.public_lng,
      CASE WHEN coalesce(i.is_location_hidden, false) THEN 'hidden' ELSE 'exact' END
    INTO v_lat, v_lng, v_precision
    FROM public.institutions i
    WHERE i.id = p_institution_id
      AND i.public_lat BETWEEN 42 AND 47
      AND i.public_lng BETWEEN 13 AND 20;

    IF FOUND THEN
      RETURN QUERY SELECT v_lat, v_lng, v_precision;
      RETURN;
    END IF;
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

  -- There is a county centroid for every county in the active publication.
  -- Keep a bounded Croatia-wide fallback so a future new county label cannot
  -- silently remove a record from the map before centroids are refreshed.
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

-- Backfill only the currently published active snapshot. Historical snapshots
-- are intentionally left alone and will be removed by the existing lifecycle.
UPDATE public.registry_directory_entries directory
SET
  institution_id = r.institution_id,
  category = CASE
    WHEN i.id IS NOT NULL THEN i.category
    WHEN r.classification_status = 'auto_eligible' AND r.mapped_category IS NOT NULL
      THEN r.mapped_category
    ELSE 'association'
  END,
  map_lat = point.latitude,
  map_lng = point.longitude,
  map_precision = point.location_precision,
  map_location = extensions.st_setsrid(
    extensions.st_makepoint(point.longitude, point.latitude), 4326
  )::extensions.geography
FROM public.registry_publication_state state
JOIN public.ngo_registry r ON true
LEFT JOIN public.institutions i ON i.id = r.institution_id
CROSS JOIN LATERAL public.registry_public_map_point(
  r.udr_id, r.city, r.zupanija, r.lat, r.lng, r.institution_id
) point
WHERE state.singleton = true
  AND directory.batch_id = state.current_batch_id
  AND directory.udr_id = r.udr_id;

CREATE OR REPLACE FUNCTION public.capture_registry_snapshot_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_category text;
  v_map record;
BEGIN
  IF NEW.import_batch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.registry_import_batches b
    WHERE b.id = NEW.import_batch_id AND b.status IN ('running', 'failed')
  ) THEN
    INSERT INTO public.registry_snapshot_memberships(batch_id, udr_id)
    VALUES (NEW.import_batch_id, NEW.udr_id)
    ON CONFLICT DO NOTHING;

    SELECT CASE
      WHEN i.id IS NOT NULL THEN i.category
      WHEN NEW.classification_status = 'auto_eligible' AND NEW.mapped_category IS NOT NULL
        THEN NEW.mapped_category
      ELSE 'association'
    END
    INTO v_category
    FROM (SELECT 1) seed
    LEFT JOIN public.institutions i ON i.id = NEW.institution_id;

    SELECT * INTO v_map
    FROM public.registry_public_map_point(
      NEW.udr_id, NEW.city, NEW.zupanija, NEW.lat, NEW.lng, NEW.institution_id
    );

    INSERT INTO public.registry_directory_entries(
      batch_id, udr_id, oib, name, short_name, status, address, city, county,
      registered_on, status_changed_on, registry_number, legal_form, email,
      website, last_verified_at, search_text, institution_id, category,
      map_lat, map_lng, map_precision, map_location
    ) VALUES (
      NEW.import_batch_id, NEW.udr_id, NEW.oib, NEW.naziv, NEW.skraceni_naziv,
      NEW.status, NEW.sjediste, NEW.city, NEW.zupanija, NEW.datum_upisa,
      NEW.datum_statusa, NEW.registarski_broj, NEW.oblik_udruzivanja, NEW.mail,
      NEW.web_stranica, NEW.last_verified_at, NEW.search_text, NEW.institution_id,
      v_category, v_map.latitude, v_map.longitude, v_map.location_precision,
      extensions.st_setsrid(
        extensions.st_makepoint(v_map.longitude, v_map.latitude), 4326
      )::extensions.geography
    )
    ON CONFLICT (batch_id, udr_id) DO UPDATE SET
      oib = EXCLUDED.oib,
      name = EXCLUDED.name,
      short_name = EXCLUDED.short_name,
      status = EXCLUDED.status,
      address = EXCLUDED.address,
      city = EXCLUDED.city,
      county = EXCLUDED.county,
      registered_on = EXCLUDED.registered_on,
      status_changed_on = EXCLUDED.status_changed_on,
      registry_number = EXCLUDED.registry_number,
      legal_form = EXCLUDED.legal_form,
      email = EXCLUDED.email,
      website = EXCLUDED.website,
      last_verified_at = EXCLUDED.last_verified_at,
      search_text = EXCLUDED.search_text,
      institution_id = EXCLUDED.institution_id,
      category = EXCLUDED.category,
      map_lat = EXCLUDED.map_lat,
      map_lng = EXCLUDED.map_lng,
      map_precision = EXCLUDED.map_precision,
      map_location = EXCLUDED.map_location;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_registry_snapshot_membership()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_registry_snapshot_membership() TO service_role;

CREATE OR REPLACE FUNCTION public.map_association_registry_v1(
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  effective_limit integer := greatest(1, least(coalesce(p_limit, 150), 200));
  normalized_query text;
  bbox_area double precision := (p_max_lng - p_min_lng) * (p_max_lat - p_min_lat);
  maximum_bbox_area double precision;
  axis_cells integer;
BEGIN
  IF length(coalesce(p_query, '')) > 256 THEN RAISE EXCEPTION 'search query input is too long'; END IF;
  IF length(coalesce(p_donation_type, '')) > 64 THEN RAISE EXCEPTION 'donation type input is too long'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(p_categories, ARRAY[]::text[])) category_value
    WHERE length(category_value) > 64
  ) THEN RAISE EXCEPTION 'category input is too long'; END IF;

  normalized_query := nullif(
    trim(regexp_replace(replace(replace(lower(coalesce(p_query, '')), '%', ' '), '_', ' '), '[[:space:]]+', ' ', 'g')),
    ''
  );

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

  axis_cells := greatest(1, floor(sqrt(effective_limit::double precision))::integer);

  RETURN QUERY
  WITH filtered AS MATERIALIZED (
    SELECT
      d.udr_id,
      i.id AS linked_institution_id,
      CASE WHEN i.id IS NULL THEN 'registry' ELSE 'institution' END AS row_entity_type,
      d.name,
      coalesce(i.category, d.category, 'association') AS row_category,
      d.city,
      CASE WHEN i.id IS NOT NULL AND NOT coalesce(i.is_location_hidden, false) THEN i.address ELSE NULL END AS row_address,
      CASE
        WHEN i.id IS NOT NULL THEN i.approximate_area
        ELSE nullif(concat_ws(', ', nullif(d.city, ''), nullif(d.county, '')), '')
      END AS row_approximate_area,
      coalesce(d.map_precision, 'county') AS row_location_precision,
      d.map_lat,
      d.map_lng,
      CASE WHEN i.id IS NULL THEN ARRAY[]::text[] ELSE coalesce(i.accepts_donations, ARRAY[]::text[]) END AS row_donations,
      coalesce(i.is_verified, false) AS row_verified,
      coalesce(i.is_location_hidden, false) AS row_hidden,
      CASE WHEN i.id IS NULL THEN 'registry' ELSE i.source END AS row_source,
      EXISTS (
        SELECT 1 FROM public.needs n
        WHERE n.institution_id = i.id AND n.urgency = 'urgent' AND n.is_fulfilled = false
      ) AS urgent
    FROM public.registry_publication_state state
    JOIN public.registry_directory_entries d ON d.batch_id = state.current_batch_id
    LEFT JOIN public.institutions i ON i.id = d.institution_id
    WHERE state.singleton = true
      AND d.map_location IS NOT NULL
      AND extensions.st_intersects(
        d.map_location,
        extensions.st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::extensions.geography
      )
      AND (coalesce(cardinality(p_categories), 0) = 0 OR coalesce(i.category, d.category, 'association') = ANY(p_categories))
      AND (p_donation_type IS NULL OR (i.id IS NOT NULL AND i.accepts_donations @> ARRAY[p_donation_type]))
      AND (NOT p_only_zagreb OR lower(coalesce(d.city, '')) = 'zagreb' OR lower(coalesce(d.city, '')) LIKE 'zagreb %')
      AND (normalized_query IS NULL OR d.search_text ILIKE '%' || normalized_query || '%')
      AND (NOT p_only_urgent OR EXISTS (
        SELECT 1 FROM public.needs n
        WHERE n.institution_id = i.id AND n.urgency = 'urgent' AND n.is_fulfilled = false
      ))
  ), stats AS (
    SELECT count(*)::bigint AS matches FROM filtered
  ), clustered AS (
    SELECT
      least(axis_cells - 1, greatest(0, floor((f.map_lng - p_min_lng) / ((p_max_lng - p_min_lng) / axis_cells))::integer)) AS cell_x,
      least(axis_cells - 1, greatest(0, floor((f.map_lat - p_min_lat) / ((p_max_lat - p_min_lat) / axis_cells))::integer)) AS cell_y,
      avg(f.map_lat) AS cluster_lat,
      avg(f.map_lng) AS cluster_lng,
      count(*)::bigint AS cluster_count,
      min(f.map_lng) AS cluster_min_lng,
      min(f.map_lat) AS cluster_min_lat,
      max(f.map_lng) AS cluster_max_lng,
      max(f.map_lat) AS cluster_max_lat,
      bool_or(f.urgent) AS cluster_urgent
    FROM filtered f CROSS JOIN stats s
    WHERE s.matches > effective_limit
    GROUP BY cell_x, cell_y
  ), counted_clusters AS (
    SELECT c.*, count(*) OVER ()::bigint AS feature_count FROM clustered c
  ), individual_rows AS (
    SELECT f.*, s.matches FROM filtered f CROSS JOIN stats s WHERE s.matches <= effective_limit
  ), combined AS (
    SELECT
      'cluster'::text AS feature_kind,
      'registry-cluster:' || p_zoom::text || ':' || c.cell_x::text || ':' || c.cell_y::text AS feature_id,
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
      c.feature_count AS total_features
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
      f.matches
    FROM individual_rows f
  )
  SELECT combined.*
  FROM combined
  ORDER BY combined.member_count DESC, combined.name NULLS LAST, combined.feature_id
  LIMIT effective_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.map_association_registry_v1(
  double precision, double precision, double precision, double precision,
  integer, text[], text, boolean, boolean, text, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_association_registry_v1(
  double precision, double precision, double precision, double precision,
  integer, text[], text, boolean, boolean, text, integer
) TO anon, authenticated, service_role;

COMMIT;
