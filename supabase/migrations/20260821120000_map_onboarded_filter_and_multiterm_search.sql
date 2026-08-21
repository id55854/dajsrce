-- Map: an "only organisations with an account" filter, plus an all-terms
-- search for both the map and the register.
--
-- 1. The map could show the whole official register or nothing, with no way to
--    narrow it to the organisations that actually hold an account here. The
--    distinguishing fact is a linked institution row, which only the query can
--    see. Filtering in the client is not equivalent: the client only receives
--    rows that survived the feature budget, and the clustering decision is
--    taken before that, so both the pins and the match count would lie.
--    `p_only_onboarded` is a new trailing argument defaulting to false, so an
--    unmodified caller behaves exactly as before.
--
-- 2. Search matched one contiguous substring of `search_text`, so `zajedno
--    znanja` found nothing while `zajedno do znanja` found the row. Both the
--    map search and the register search now require every term to appear, in
--    any order. The first term stays a positive ILIKE so the existing GIN
--    trigram index on `search_text` still drives the scan.
--
-- The map functions gain an argument, so they are dropped and recreated rather
-- than replaced: CREATE OR REPLACE with a new signature leaves the old arity
-- in place as a second overload that silently ignores the new filter. The
-- definitions are otherwise carried over unchanged, including SECURITY
-- DEFINER, STABLE, the schema-qualified search_path and the caller grants.

BEGIN;

DROP FUNCTION IF EXISTS public.map_association_registry_v2(double precision, double precision, double precision, double precision, integer, text[], text, boolean, boolean, text, integer);
DROP FUNCTION IF EXISTS public.map_association_registry_v1(double precision, double precision, double precision, double precision, integer, text[], text, boolean, boolean, text, integer);

CREATE OR REPLACE FUNCTION public.map_association_registry_v1(p_min_lng double precision, p_min_lat double precision, p_max_lng double precision, p_max_lat double precision, p_zoom integer, p_categories text[] DEFAULT ARRAY[]::text[], p_donation_type text DEFAULT NULL::text, p_only_zagreb boolean DEFAULT false, p_only_urgent boolean DEFAULT false, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 150, p_only_onboarded boolean DEFAULT false)
RETURNS TABLE(feature_kind text, feature_id text, institution_id uuid, registry_id text, entity_type text, name text, category text, city text, address text, approximate_area text, location_precision text, latitude double precision, longitude double precision, accepts_donations text[], is_verified boolean, is_location_hidden boolean, source text, has_urgent_need boolean, member_count bigint, min_lng double precision, min_lat double precision, max_lng double precision, max_lat double precision, total_matches bigint, total_features bigint)
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
  -- adjacent in this order". The old single substring match returned nothing
  -- for `zajedno znanja` while `zajedno do znanja` matched, which reads as
  -- "the register does not have it". The first term keeps a plain positive
  -- ILIKE so the trigram index still drives the scan; the rest only narrow
  -- what that returns. Six terms is plenty for a name and bounds the work.
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
$function$;

CREATE OR REPLACE FUNCTION public.map_association_registry_v2(p_min_lng double precision, p_min_lat double precision, p_max_lng double precision, p_max_lat double precision, p_zoom integer, p_categories text[] DEFAULT ARRAY[]::text[], p_donation_type text DEFAULT NULL::text, p_only_zagreb boolean DEFAULT false, p_only_urgent boolean DEFAULT false, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 150, p_only_onboarded boolean DEFAULT false)
RETURNS TABLE(feature_kind text, feature_id text, institution_id uuid, registry_id text, entity_type text, name text, category text, city text, address text, approximate_area text, location_precision text, latitude double precision, longitude double precision, accepts_donations text[], is_verified boolean, is_location_hidden boolean, source text, has_urgent_need boolean, member_count bigint, min_lng double precision, min_lat double precision, max_lng double precision, max_lat double precision, total_matches bigint, total_features bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
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
    p_donation_type, p_only_zagreb, p_only_urgent, p_query, p_limit,
    p_only_onboarded
  ) feature
  LEFT JOIN public.registry_publication_state state ON state.singleton = true
  LEFT JOIN public.registry_directory_entries directory
    ON directory.batch_id = state.current_batch_id
   AND directory.udr_id = feature.registry_id;
$function$;

CREATE OR REPLACE FUNCTION public.search_association_registry_v1(p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_county text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_form text DEFAULT NULL::text, p_sort text DEFAULT 'name_asc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_batch_id text;
  v_query text := nullif(btrim(p_query), '');
  v_status text := nullif(btrim(p_status), '');
  v_county text := nullif(btrim(p_county), '');
  v_city text := nullif(btrim(p_city), '');
  v_form text := nullif(btrim(p_form), '');
  v_order text;
  v_terms text[];
  v_total bigint;
  v_items jsonb;
BEGIN
  IF p_page < 1 OR p_page > 10000 OR p_page_size < 1 OR p_page_size > 100 THEN RAISE EXCEPTION 'invalid pagination' USING ERRCODE = '22023'; END IF;
  IF char_length(coalesce(v_query, '')) > 100 OR char_length(coalesce(v_status, '')) > 100 OR
     char_length(coalesce(v_county, '')) > 100 OR char_length(coalesce(v_city, '')) > 150 OR
     char_length(coalesce(v_form, '')) > 150 THEN RAISE EXCEPTION 'registry filter is too long' USING ERRCODE = '22023'; END IF;
  v_order := CASE p_sort
    WHEN 'name_asc' THEN 'd.name COLLATE public.hr_sort ASC, d.udr_id ASC'
    WHEN 'name_desc' THEN 'd.name COLLATE public.hr_sort DESC, d.udr_id ASC'
    WHEN 'registered_desc' THEN 'd.registered_on DESC NULLS LAST, d.name COLLATE public.hr_sort ASC, d.udr_id ASC'
    WHEN 'registered_asc' THEN 'd.registered_on ASC NULLS LAST, d.name COLLATE public.hr_sort ASC, d.udr_id ASC'
    WHEN 'status_changed_desc' THEN 'd.status_changed_on DESC NULLS LAST, d.name COLLATE public.hr_sort ASC, d.udr_id ASC'
    ELSE NULL END;
  IF v_order IS NULL THEN RAISE EXCEPTION 'invalid registry sort' USING ERRCODE = '22023'; END IF;
  SELECT current_batch_id INTO v_batch_id FROM public.registry_publication_state WHERE singleton = true;

  -- Same all-terms rule as the map; see map_association_registry_v1.
  v_terms := (
    SELECT array_agg(term)
    FROM (
      SELECT term
      FROM unnest(string_to_array(lower(coalesce(v_query, '')), ' ')) AS term
      WHERE length(term) >= 2
      LIMIT 6
    ) capped
  );
  IF coalesce(cardinality(v_terms), 0) = 0 AND v_query IS NOT NULL THEN
    v_terms := ARRAY[lower(v_query)];
  END IF;

  IF v_query IS NULL AND v_status IS NULL AND v_county IS NULL AND v_city IS NULL AND v_form IS NULL THEN
    SELECT total INTO v_total
    FROM public.registry_snapshot_facets
    WHERE batch_id = v_batch_id;
  ELSE
    SELECT count(*) INTO v_total FROM public.registry_directory_entries d
    WHERE d.batch_id = v_batch_id
      AND (
        v_terms IS NULL
        OR (
          d.search_text ILIKE '%' || v_terms[1] || '%'
          AND NOT EXISTS (
            SELECT 1 FROM unnest(v_terms[2:]) AS term
            WHERE d.search_text NOT ILIKE '%' || term || '%'
          )
        )
      )
      AND (v_status IS NULL OR d.status = v_status)
      AND (v_county IS NULL OR d.county = v_county)
      AND (v_city IS NULL OR d.city ILIKE '%' || v_city || '%')
      AND (v_form IS NULL OR d.legal_form = v_form);
  END IF;

  EXECUTE pg_catalog.format($query$
    SELECT coalesce(jsonb_agg(item), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'id', d.udr_id, 'oib', d.oib, 'name', d.name, 'short_name', d.short_name,
        'status', d.status, 'address', d.address, 'city', d.city, 'county', d.county,
        'registered_on', d.registered_on, 'status_changed_on', d.status_changed_on,
        'registry_number', d.registry_number, 'legal_form', d.legal_form,
        'email', d.email, 'website', d.website, 'last_verified_at', d.last_verified_at
      ) item
      FROM public.registry_directory_entries d
      WHERE d.batch_id = $1
        AND (
          $2 IS NULL
          OR (
            d.search_text ILIKE '%%' || $2[1] || '%%'
            AND NOT EXISTS (
              SELECT 1 FROM unnest($2[2:]) AS term
              WHERE d.search_text NOT ILIKE '%%' || term || '%%'
            )
          )
        )
        AND ($3 IS NULL OR d.status = $3)
        AND ($4 IS NULL OR d.county = $4)
        AND ($5 IS NULL OR d.city ILIKE '%%' || $5 || '%%')
        AND ($6 IS NULL OR d.legal_form = $6)
      ORDER BY %s LIMIT $7 OFFSET $8
    ) page_rows
  $query$, v_order)
  INTO v_items
  USING v_batch_id, v_terms, v_status, v_county, v_city, v_form, p_page_size, (p_page - 1) * p_page_size;

  RETURN jsonb_build_object('version', 1, 'items', v_items, 'meta', jsonb_build_object(
    'total', v_total, 'page', p_page, 'page_size', p_page_size,
    'page_count', CASE WHEN v_total = 0 THEN 0 ELSE ceil(v_total::numeric / p_page_size)::integer END));
END;
$function$;

REVOKE ALL ON FUNCTION public.map_association_registry_v1(double precision, double precision, double precision, double precision, integer, text[], text, boolean, boolean, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.map_association_registry_v2(double precision, double precision, double precision, double precision, integer, text[], text, boolean, boolean, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_association_registry_v1(text, text, text, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_association_registry_v1(double precision, double precision, double precision, double precision, integer, text[], text, boolean, boolean, text, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.map_association_registry_v2(double precision, double precision, double precision, double precision, integer, text[], text, boolean, boolean, text, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_association_registry_v1(text, text, text, text, text, text, integer, integer) TO anon, authenticated, service_role;

COMMIT;
