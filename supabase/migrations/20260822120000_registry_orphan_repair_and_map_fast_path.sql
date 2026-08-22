-- Storage and map-availability repair.
--
-- Symptom 1: the database passed the 500 MB plan ceiling (554 MB).
-- Symptom 2: the public map intermittently returned 503 "Institution
--            locations are temporarily unavailable".
--
-- Both trace to the same cause. sync-official-registry.mjs throws the moment
-- the staged importer exits non-zero, and the post-publication maintenance
-- step that purges non-current projection rows sits *after* that throw. So a
-- failed sync leaks its whole partial projection. One such run
-- (registry-b9ac80c1fca9659b8195) left 26,500 rows in
-- registry_directory_entries and registry_snapshot_memberships on top of the
-- 43,654 published rows: 38% dead weight in the two largest tables, and a 38%
-- larger GiST scan on every single map viewport request.
--
-- The instance has 224 MB of shared_buffers. Once the map working set no
-- longer fit, a cold viewport read went to disk and took ~7 s against the 3 s
-- statement_timeout the anon role carries - a hard 503. Warm, the identical
-- query returned in ~220 ms. That is exactly the "sometimes loads, sometimes
-- not" the map showed: a cache-residency coin flip, not a flaky client.
--
-- This migration repairs the leaked state, removes the ways it can recur, and
-- cuts the map query cold cost so it has headroom even on a cache miss.
-- Physical space reclamation (REINDEX/VACUUM) is deliberately not here: it
-- cannot run inside a transaction. Run `npm run registry:reclaim` afterwards.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Repair canonical ownership.
-- ---------------------------------------------------------------------------
-- The failed run merged real rows into ngo_registry and stamped them with its
-- own import_batch_id before dying. Every one of those rows is present in the
-- currently published directory snapshot, so the published batch is their
-- rightful owner. Leaving them mis-stamped is not cosmetic: the legacy
-- reconciler below reads "belongs to another batch" as "no longer in the
-- source" and would flip source_present to false on 26,500 live organisations,
-- hiding them from the register, the detail lookups and the facet counts.
UPDATE public.ngo_registry registry
SET import_batch_id = state.current_batch_id
FROM public.registry_publication_state state
WHERE state.singleton = true
  AND registry.import_batch_id IS DISTINCT FROM state.current_batch_id
  AND EXISTS (
    SELECT 1
    FROM public.registry_directory_entries entries
    WHERE entries.batch_id = state.current_batch_id
      AND entries.udr_id = registry.udr_id
  );

-- Failed batches are bookkeeping for work that produced nothing publishable.
-- Their rows cascade away with them: ngo_registry_staging,
-- registry_directory_entries, registry_snapshot_memberships and
-- registry_snapshot_facets all reference this table ON DELETE CASCADE. That
-- also clears the orphaned staging rows partial imports left behind. The
-- published batch can never match here; publication requires 'completed'.
DELETE FROM public.registry_import_batches batch
WHERE batch.status = 'failed'
  AND batch.id IS DISTINCT FROM (
    SELECT current_batch_id FROM public.registry_publication_state WHERE singleton = true
  );

-- ---------------------------------------------------------------------------
-- 2. Make the legacy visibility reconciler safe and terminating.
-- ---------------------------------------------------------------------------
-- The old body picked "the oldest other batch that still has source_present
-- rows" and switched those rows off. That is a proxy for "not in the current
-- source", and it is wrong whenever a canonical row carries a stale batch
-- stamp - precisely the state a failed import creates. It also could not
-- converge: every call re-derived the same 26,500-row target set, and at 62
-- rows per timeout-bisected call the maintenance script ground indefinitely.
--
-- Membership of the published directory snapshot is the fact actually being
-- reconciled, so key on it directly. It is exact rather than inferred, it is
-- served by registry_directory_entries_pkey, and it converges monotonically:
-- each call strictly shrinks the disagreeing set.
CREATE OR REPLACE FUNCTION public.reconcile_registry_source_presence_batch(
  p_batch_id text,
  p_limit integer DEFAULT 250
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 250), 1000));
  v_enabled integer := 0;
  v_disabled integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.registry_import_batches
    WHERE id = p_batch_id AND status = 'completed' AND mirror_scope = 'active'
  ) THEN
    RAISE EXCEPTION 'registry batch is not a completed active snapshot' USING ERRCODE = '22023';
  END IF;

  -- Publish: in the snapshot but still hidden.
  WITH targets AS (
    SELECT registry.udr_id
    FROM public.ngo_registry registry
    WHERE registry.source_present = false
      AND EXISTS (
        SELECT 1 FROM public.registry_directory_entries entries
        WHERE entries.batch_id = p_batch_id AND entries.udr_id = registry.udr_id
      )
    ORDER BY registry.udr_id
    LIMIT v_limit
    FOR UPDATE OF registry SKIP LOCKED
  )
  UPDATE public.ngo_registry registry
  SET source_present = true
  FROM targets
  WHERE registry.udr_id = targets.udr_id;
  GET DIAGNOSTICS v_enabled = ROW_COUNT;

  -- Retire: visible but absent from the snapshot. The batch stamp is not
  -- consulted, so a stale stamp can no longer hide a live organisation.
  WITH targets AS (
    SELECT registry.udr_id
    FROM public.ngo_registry registry
    WHERE registry.source_present = true
      AND NOT EXISTS (
        SELECT 1 FROM public.registry_directory_entries entries
        WHERE entries.batch_id = p_batch_id AND entries.udr_id = registry.udr_id
      )
    ORDER BY registry.udr_id
    LIMIT v_limit
    FOR UPDATE OF registry SKIP LOCKED
  )
  UPDATE public.ngo_registry registry
  SET source_present = false
  FROM targets
  WHERE registry.udr_id = targets.udr_id;
  GET DIAGNOSTICS v_disabled = ROW_COUNT;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'disabled', v_disabled,
    'complete', v_enabled = 0 AND v_disabled = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_registry_source_presence_batch(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_registry_source_presence_batch(text, integer)
  TO service_role;

COMMENT ON FUNCTION public.cleanup_registry_snapshot_storage_batch(integer) IS
  'Removes projection rows outside the published snapshot, 1..1000 at a time. '
  'Drain until complete=true. Must run after every sync attempt, successful or '
  'not: a failed import leaves a full partial projection behind.';

-- ---------------------------------------------------------------------------
-- 3. Map viewport query: narrow first, widen only what is returned.
-- ---------------------------------------------------------------------------
-- The previous body built one MATERIALIZED CTE carrying every output column -
-- name, address, approximate area, donation array, source - for every row in
-- the viewport, then decided whether to cluster. At Zagreb zoom 12 that is
-- ~11,200 wide rows materialised so that at most 150 features can be emitted,
-- and it spilled ~5 MB to temp files on each call. When the result clusters,
-- not one of those text columns is ever read.
--
-- Split it: `candidates` carries only identity and coordinates, which is
-- everything the match count, the clustering decision and a clustered response
-- need. The wide columns are joined back only in the individual-row branch,
-- which by construction holds at most `effective_limit` rows. Filter
-- semantics, output columns, ordering and the feature budget are unchanged.
--
-- The urgent-need test also moves out of the row loop. It was a correlated
-- EXISTS against `needs` evaluated once per candidate row; `needs` is tiny, so
-- gathering the urgent institution ids once and probing that set is the same
-- answer for a fraction of the work.
--
-- The signature is unchanged, so v2 and both callers stay as they are.
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
