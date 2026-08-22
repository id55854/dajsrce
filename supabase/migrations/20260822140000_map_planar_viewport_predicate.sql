-- Map viewport: match the planar box the client actually asked for.
--
-- After the orphan purge and the index rebuild, the Zagreb zoom-12 viewport
-- measured a 707 ms median but a 5.6 s tail over eight samples. The `anon`
-- role's statement_timeout is 3 s, so the tail is still a 503 - the map stays a
-- coin flip, just a better-weighted one. Median latency was never the problem.
--
-- What is left is per-row work, not I/O: the surviving cost is a geodesic
-- st_intersects evaluated against every row the GiST index returns - 11,308 of
-- them for that viewport, of which it rejects 126. On a two-vCPU shared
-- instance that recheck is what stretches into multi-second outliers under
-- contention.
--
-- A Leaflet viewport is an axis-aligned lat/lng rectangle, and every row here
-- is a Point. For points against an axis-aligned box, a planar bounding-box
-- test is not an approximation of the geodesic answer, it is the same answer -
-- and it is the answer that matches what the browser drew. Measured against
-- the published snapshot at three viewports:
--
--   country z6   43,654 agree,     0 differ
--   split   z14   1,899 agree,     0 differ
--   zagreb  z12  11,182 agree,     1 planar-only (a point exactly on the edge,
--                                  which an inclusive viewport should show)
--
-- So this swaps the geodesic predicate for `&&` on the geometry cast, and adds
-- the planar GiST index that serves it. The cast is IMMUTABLE, so it indexes.
--
-- The geography index it replaces is dropped: a grep over every migration
-- shows map_location has exactly one spatial read site, the map function below;
-- the remaining references all write the column. Keeping both would make the
-- twice-daily sync maintain two GiST indexes over the same 43,654 points.
-- Rebuilding it is seconds of work if that ever turns out to be wrong.
--
-- CREATE INDEX is deliberately not CONCURRENTLY: it cannot run inside the
-- transaction this file needs, and the only writer to this table is the sync
-- job, which is not running during a deploy.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_registry_directory_entries_viewport
  ON public.registry_directory_entries
  USING gist (((map_location)::extensions.geometry))
  WHERE map_location IS NOT NULL;

DROP INDEX IF EXISTS public.idx_registry_directory_entries_map_location;

-- Only the WHERE clause changes; every filter, output column, cluster rule and
-- ordering below is carried over from
-- 20260822120000_registry_orphan_repair_and_map_fast_path.sql unchanged.
CREATE OR REPLACE FUNCTION public.map_association_registry_v1(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_zoom integer,
  p_categories text[] DEFAULT ARRAY[]::text[],
  p_donation_type text DEFAULT NULL::text,
  p_only_zagreb boolean DEFAULT false,
  p_only_urgent boolean DEFAULT false,
  p_query text DEFAULT NULL::text,
  p_limit integer DEFAULT 150,
  p_only_onboarded boolean DEFAULT false
)
RETURNS TABLE(
  feature_kind text, feature_id text, institution_id uuid, registry_id text,
  entity_type text, name text, category text, city text, address text,
  approximate_area text, location_precision text, latitude double precision,
  longitude double precision, accepts_donations text[], is_verified boolean,
  is_location_hidden boolean, source text, has_urgent_need boolean,
  member_count bigint, min_lng double precision, min_lat double precision,
  max_lng double precision, max_lat double precision, total_matches bigint,
  total_features bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  effective_limit integer := greatest(1, least(coalesce(p_limit, 150), 200));
  normalized_query text;
  bbox_area double precision := (p_max_lng - p_min_lng) * (p_max_lat - p_min_lat);
  maximum_bbox_area double precision;
  axis_cells integer;
  query_terms text[];
  viewport extensions.geometry;
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

  -- A visitor typing two words means "both of these", not "these two words
  -- adjacent in this order". The first term keeps a plain positive ILIKE so the
  -- trigram index still drives the scan; the rest only narrow what it returns.
  -- Six terms is plenty for a name and bounds the work.
  query_terms := (
    SELECT array_agg(term)
    FROM (
      SELECT term
      FROM unnest(string_to_array(coalesce(normalized_query, ''), ' ')) AS term
      WHERE length(term) >= 2
      LIMIT 6
    ) capped
  );
  IF coalesce(cardinality(query_terms), 0) = 0 AND normalized_query IS NOT NULL THEN
    -- Every token was a single character; match the query as typed rather than
    -- silently dropping the filter and returning the whole register.
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
  ), candidates AS MATERIALIZED (
    -- Identity and geometry only. Everything downstream that has to see the
    -- whole match set - the count, the cluster grid - reads only these.
    SELECT
      d.udr_id,
      i.id AS linked_institution_id,
      d.map_lat,
      d.map_lng,
      (i.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM urgent_institutions u WHERE u.institution_id = i.id
      )) AS urgent
    FROM public.registry_publication_state state
    JOIN public.registry_directory_entries d ON d.batch_id = state.current_batch_id
    LEFT JOIN public.institutions i ON i.id = d.institution_id
    WHERE state.singleton = true
      AND d.map_location IS NOT NULL
      -- Index-only bounding-box containment. Exact for points against an
      -- axis-aligned viewport, and served by idx_..._viewport.
      AND (d.map_location)::extensions.geometry && viewport
      AND (coalesce(cardinality(p_categories), 0) = 0 OR coalesce(i.category, d.category, 'association') = ANY(p_categories))
      AND (p_donation_type IS NULL OR (i.id IS NOT NULL AND i.accepts_donations @> ARRAY[p_donation_type]))
      AND (NOT p_only_zagreb OR lower(coalesce(d.city, '')) = 'zagreb' OR lower(coalesce(d.city, '')) LIKE 'zagreb %')
      AND (
        query_terms IS NULL
        OR (
          d.search_text ILIKE '%' || query_terms[1] || '%'
          AND NOT EXISTS (
            SELECT 1 FROM unnest(query_terms[2:]) AS term
            WHERE d.search_text NOT ILIKE '%' || term || '%'
          )
        )
      )
      -- Onboarded means a linked institution row, the only fact separating an
      -- organisation that can receive help from a bare register entry.
      -- Filtering here rather than in the client matters because the client
      -- only ever sees rows that survived the feature budget, and the
      -- clustering decision is made before that.
      AND (NOT p_only_onboarded OR i.id IS NOT NULL)
      AND (NOT p_only_urgent OR (i.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM urgent_institutions u WHERE u.institution_id = i.id
      )))
  ), stats AS (
    SELECT count(*)::bigint AS matches FROM candidates
  ), clustered AS (
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
    FROM candidates c CROSS JOIN stats s
    WHERE s.matches > effective_limit
    GROUP BY cell_x, cell_y
  ), counted_clusters AS (
    SELECT c.*, count(*) OVER ()::bigint AS feature_count FROM clustered c
  ), individual_keys AS (
    -- Reached only when the whole match set fits inside the feature budget, so
    -- this holds at most effective_limit rows and the widening join below is
    -- bounded by the same number.
    SELECT c.*, s.matches FROM candidates c CROSS JOIN stats s WHERE s.matches <= effective_limit
  ), individual_rows AS (
    SELECT
      k.udr_id,
      k.linked_institution_id,
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
    JOIN public.registry_directory_entries d
      ON d.batch_id = state.current_batch_id AND d.udr_id = k.udr_id
    LEFT JOIN public.institutions i ON i.id = k.linked_institution_id
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
$function$;

REVOKE ALL ON FUNCTION public.map_association_registry_v1(
  double precision, double precision, double precision, double precision,
  integer, text[], text, boolean, boolean, text, integer, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_association_registry_v1(
  double precision, double precision, double precision, double precision,
  integer, text[], text, boolean, boolean, text, integer, boolean
) TO anon, authenticated, service_role;

COMMIT;
