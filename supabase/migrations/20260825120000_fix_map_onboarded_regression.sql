-- The map's "Na DajSrcu" filter (p_only_onboarded) is supposed to mean
-- "this organisation has a real, approved NGO account behind it", not
-- "this row happens to exist in public.institutions". The registry
-- promotion pipeline bulk-inserts an institutions row for every donation
-- candidate the classifier finds (source = 'registry'), with nobody behind
-- it, so a plain "i.id IS NOT NULL" check counts thousands of those as
-- "onboarded".
--
-- 20260821130000_map_onboarded_requires_account.sql fixed this exact check
-- to require an owning public.profiles row (profiles.role = 'ngo' AND
-- profiles.institution_id = i.id). 20260822160000_city_districts_and_place_
-- clustering.sql then rewrote map_association_registry_v1 wholesale to add
-- place-based clustering, apparently branching from a copy that predated
-- that fix, and carried the regressed "i.id IS NOT NULL" check forward
-- through every subsequent CREATE OR REPLACE on this function
-- (20260822180000, 20260822200000, 20260822220000). The practical effect:
-- toggling "Na DajSrcu" on the public map returned essentially the whole
-- register (~2,400+ rows) instead of the handful of organisations an actual
-- person has signed up and had a claim approved for.
--
-- This migration re-applies the current (place-clustering, single-pass
-- stats) function body verbatim, with only that one predicate restored.
-- map_association_registry_v2 and engaged_association_directory_v1 (the
-- /organisations listing) are unaffected -- v2 only forwards the parameter
-- to v1, and the organisations directory already carries its own correct
-- profiles-EXISTS check untouched by any of this.

BEGIN;

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
    trim(regexp_replace(replace(replace(lower(coalesce(p_query, '')), '%', ' '), '_', ' '), '[[:space:]]+', ' ', 'g')),
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
          d.search_text ILIKE '%' || query_terms[1] || '%'
          AND NOT EXISTS (
            SELECT 1 FROM unnest(query_terms[2:]) AS term
            WHERE d.search_text NOT ILIKE '%' || term || '%'
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
