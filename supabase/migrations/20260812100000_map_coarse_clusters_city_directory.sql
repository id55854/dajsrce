-- Coarser map clustering, plus a bounded public city directory for the map.
--
-- 1. `map_association_registry_v1` grouped a crowded viewport into a
--    floor(sqrt(limit)) grid -- 12 x 12, so up to 144 bubbles at once, which
--    reads as noise rather than as structure. The grid is capped at 6 x 6 (36)
--    so a zoomed-out view resolves into a handful of legible groups. Only the
--    cell count changes: the trigger (more matches than the feature budget),
--    the member counts, the returned bounds and the API contract are the same,
--    and v2 inherits this because it delegates its clustering here.
--
-- 2. `registry_map_cities_v1` backs the map's "choose a city" affordance, for
--    visitors who decline or cannot use geolocation. It is a public, bounded,
--    allow-listed read over the currently published snapshot joined to the
--    precomputed location centroids; it exposes only aggregate city points and
--    counts, never a row-level location.

BEGIN;
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

  axis_cells := greatest(1, least(6, floor(sqrt(effective_limit::double precision))::integer));

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

-- The map's city picker. Aggregate-only: a city label, its county, the
-- precomputed median point for that city and how many published organisations
-- sit in it. No row-level location or identity crosses this boundary, so it is
-- safe to expose to anon, and the HTTP layer caches it at the CDN.
CREATE OR REPLACE FUNCTION public.registry_map_cities_v1(
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 40
)
RETURNS TABLE (
  city text,
  county text,
  latitude double precision,
  longitude double precision,
  organisation_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  effective_limit integer := greatest(1, least(coalesce(p_limit, 40), 100));
  needle text;
BEGIN
  IF length(coalesce(p_query, '')) > 80 THEN
    RAISE EXCEPTION 'city query input is too long';
  END IF;

  needle := nullif(public.registry_location_key(coalesce(p_query, '')), '');

  RETURN QUERY
  WITH grouped AS (
    SELECT
      d.city AS city_label,
      d.county AS county_label,
      public.registry_location_key(d.city) AS city_key,
      public.registry_location_key(d.county) AS county_key,
      count(*)::bigint AS organisation_count
    FROM public.registry_publication_state state
    JOIN public.registry_directory_entries d ON d.batch_id = state.current_batch_id
    WHERE state.singleton = true
      AND d.city IS NOT NULL
      AND btrim(d.city) <> ''
      AND d.county IS NOT NULL
      AND btrim(d.county) <> ''
      AND (needle IS NULL OR public.registry_location_key(d.city) LIKE needle || '%')
    GROUP BY d.city, d.county
  )
  SELECT
    g.city_label,
    g.county_label,
    c.latitude,
    c.longitude,
    g.organisation_count
  FROM grouped g
  JOIN public.registry_location_centroids c
    ON c.county_key = g.county_key
   AND c.city_key = g.city_key
  ORDER BY g.organisation_count DESC, g.city_label
  LIMIT effective_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.registry_map_cities_v1(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registry_map_cities_v1(text, integer)
  TO anon, authenticated, service_role;

COMMIT;