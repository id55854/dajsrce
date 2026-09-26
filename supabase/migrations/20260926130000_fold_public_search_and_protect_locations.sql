-- Diacritic-insensitive public search, and violence-support locations kept
-- coarse in the database as well.
--
-- 1. The register directory (/organisations), the map search and the city
--    picker matched raw lower-cased text, so "crveni kriz" found nothing where
--    "crveni križ" found 131, and "sibenik" found no city. They now compare
--    folded text on both sides (hr_fold, 20260926110000). Folding per row is
--    too slow where a viewport index drives the plan (about 20 us a row, a
--    second for all of Croatia), so the folded register text is a stored
--    generated column, search_fold, indexed in 20260926131000. The claim
--    search moves to it as well. Bodies are the live ones from 2026-09-26 with
--    only the search predicates and the term order changed.
-- 2. The application already projects the domestic_violence category to a
--    coarse point on every public path unless the row is curated. The rows
--    themselves are now hidden too, so a need or event of such an organisation
--    cannot carry the exact seat through public_address/public_lat/public_lng,
--    and approval hides a claimed organisation of that category.

-- Rewrites the table once (about 43k rows). The snapshot capture trigger
-- inserts with an explicit column list, so new rows get the column computed.
ALTER TABLE public.registry_directory_entries
  ADD COLUMN IF NOT EXISTS search_fold text
  GENERATED ALWAYS AS (public.hr_fold(search_text)) STORED;


CREATE OR REPLACE FUNCTION public.search_association_registry_v1(p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_county text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_form text DEFAULT NULL::text, p_sort text DEFAULT 'name_asc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 24, p_classified_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
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
  -- Folded like search_fold, most selective term first (the first term
  -- drives the trigram index): words found in most association names last,
  -- longer words first.
  v_terms := (
    SELECT array_agg(term ORDER BY (term = ANY (ARRAY['udruga', 'udruge', 'za', 'i', 'u', 'na', 'od', 'do', 's', 'sa', 'o', 'hrvatska', 'hrvatski', 'hrvatsko', 'hrvatske', 'republike', 'grad', 'grada', 'drustvo', 'klub', 'savez', 'centar', 'zajednica', 'sportski', 'sportska', 'kulturno', 'umjetnicko', 'gradsko', 'opcine', 'zupanije'])) ASC, length(term) DESC, term)
    FROM (
      SELECT term
      FROM unnest(string_to_array(public.hr_fold(coalesce(v_query, '')), ' ')) AS term
      WHERE length(term) >= 2
      LIMIT 6
    ) capped
  );
  IF coalesce(cardinality(v_terms), 0) = 0 AND v_query IS NOT NULL THEN
    v_terms := ARRAY[public.hr_fold(v_query)];
  END IF;

  -- The immutable facets total is the whole register, so the fast path only
  -- applies when nothing -- including the classified-only filter -- narrows it.
  IF v_query IS NULL AND v_status IS NULL AND v_county IS NULL AND v_city IS NULL AND v_form IS NULL AND NOT p_classified_only THEN
    SELECT total INTO v_total
    FROM public.registry_snapshot_facets
    WHERE batch_id = v_batch_id;
  ELSE
    SELECT count(*) INTO v_total FROM public.registry_directory_entries d
    WHERE d.batch_id = v_batch_id
      AND (
        v_terms IS NULL
        OR (
          d.search_fold LIKE '%' || v_terms[1] || '%'
          AND NOT EXISTS (
            SELECT 1 FROM unnest(v_terms[2:]) AS term
            WHERE d.search_fold NOT LIKE '%' || term || '%'
          )
        )
      )
      AND (v_status IS NULL OR d.status = v_status)
      AND (v_county IS NULL OR d.county = v_county)
      AND (v_city IS NULL OR public.hr_fold(d.city) LIKE '%' || public.hr_fold(v_city) || '%')
      AND (v_form IS NULL OR d.legal_form = v_form)
      AND (NOT p_classified_only OR d.category <> 'association');
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
            d.search_fold LIKE '%%' || $2[1] || '%%'
            AND NOT EXISTS (
              SELECT 1 FROM unnest($2[2:]) AS term
              WHERE d.search_fold NOT LIKE '%%' || term || '%%'
            )
          )
        )
        AND ($3 IS NULL OR d.status = $3)
        AND ($4 IS NULL OR d.county = $4)
        AND ($5 IS NULL OR public.hr_fold(d.city) LIKE '%%' || public.hr_fold($5) || '%%')
        AND ($6 IS NULL OR d.legal_form = $6)
        AND (NOT $9 OR d.category <> 'association')
      ORDER BY %s LIMIT $7 OFFSET $8
    ) page_rows
  $query$, v_order)
  INTO v_items
  USING v_batch_id, v_terms, v_status, v_county, v_city, v_form, p_page_size, (p_page - 1) * p_page_size, p_classified_only;

  RETURN jsonb_build_object('version', 1, 'items', v_items, 'meta', jsonb_build_object(
    'total', v_total, 'page', p_page, 'page_size', p_page_size,
    'page_count', CASE WHEN v_total = 0 THEN 0 ELSE ceil(v_total::numeric / p_page_size)::integer END));
END;
$function$;

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
    WHERE i.source = 'curated'
      AND i.is_verified = true
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

CREATE OR REPLACE FUNCTION public.registry_map_cities_v1(p_query text DEFAULT NULL::text, p_limit integer DEFAULT 40)
 RETURNS TABLE(city text, county text, latitude double precision, longitude double precision, organisation_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      AND (needle IS NULL OR public.hr_fold(d.city) LIKE public.hr_fold(p_query) || '%')
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
$function$;

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
        AND d.search_fold LIKE '%' || v_anchor || '%'
        AND NOT EXISTS (
          SELECT 1 FROM unnest(v_terms) AS term
          WHERE position(term IN d.search_fold) = 0
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

-- The public-location trigger fires on UPDATE OF is_location_hidden, so the
-- public_* projection is recomputed for each row.
UPDATE public.institutions
SET is_location_hidden = true
WHERE category = 'domestic_violence'
  AND source <> 'curated'
  AND NOT is_location_hidden;

ANALYZE public.registry_directory_entries;
