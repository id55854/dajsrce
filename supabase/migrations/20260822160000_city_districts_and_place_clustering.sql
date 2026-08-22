-- Name the clusters after places instead of counting them.
--
-- The map answered a zoomed-out viewport with "Grupa od 1090 ustanova" - a
-- count with no referent. The clustering was a 12x12 grid laid over whatever
-- rectangle the browser happened to be showing, so a cluster was an artefact of
-- the viewport, not a thing anyone could name, and its bounds moved every time
-- the map panned.
--
-- Croatia already has the names. The published snapshot carries county on 100%
-- of rows and city on 99.8%, and 90% of rows are geocoded to an exact street
-- address. What it lacked was anything between "Zagreb" and a street: 9,766 of
-- the ~10,400 rows in Grad Zagreb have city = 'Zagreb', so a city-level cluster
-- is useless exactly where the density is worst.
--
-- So this adds Zagreb's 17 gradske cetvrti as real boundaries and assigns each
-- row by point-in-polygon. Measured against the published snapshot, 10,404 of
-- 10,412 Grad Zagreb rows fall inside a district; all 8 misses are rows with no
-- exact geocode, which sit on a city or county centroid by construction.
--
-- Clustering then picks the finest named grouping that fits the feature budget:
--
--   street -> district -> city -> county -> (spatial grid, unchanged fallback)
--
-- Each tier's key falls back to the next coarser one, so every tier covers
-- every row and a viewport that straddles Zagreb's edge still works: the Zagreb
-- rows group by district while Velika Gorica groups by city, in one response.
--
-- Boundary data: OpenStreetMap relations, admin_level=9, retrieved 2026-08-22,
-- (c) OpenStreetMap contributors, ODbL 1.0. Loaded by
-- `npm run registry:districts` from data/zagreb-city-districts.geojson.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. District boundaries.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.city_districts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city text NOT NULL,
  name text NOT NULL,
  osm_relation bigint,
  boundary extensions.geometry(MultiPolygon, 4326) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT city_districts_city_name_key UNIQUE (city, name)
);

CREATE INDEX IF NOT EXISTS idx_city_districts_boundary
  ON public.city_districts USING gist (boundary);

-- Public reads never touch this table directly; the map function below is
-- SECURITY DEFINER and is the only reader. RLS on with no policy keeps it that
-- way rather than relying on nobody noticing it is there.
ALTER TABLE public.city_districts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.city_districts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.city_districts TO service_role;

-- Loading is one transactional call rather than a row-at-a-time client loop:
-- a half-applied boundary set would assign rows to districts that no longer
-- exist while leaving others unassigned, and the map would show both.
-- Districts absent from the payload for a city named in it are removed, so the
-- committed GeoJSON stays the single source of truth for that city.
CREATE OR REPLACE FUNCTION public.upsert_city_districts(p_districts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_inserted integer := 0;
  v_removed integer := 0;
BEGIN
  IF p_districts IS NULL OR jsonb_typeof(p_districts) <> 'array'
     OR jsonb_array_length(p_districts) = 0 THEN
    RAISE EXCEPTION 'p_districts must be a non-empty array' USING ERRCODE = '22023';
  END IF;

  -- pg_temp-qualified: this function is SECURITY DEFINER, and an unqualified
  -- relation name in one resolves through the temporary schema first.
  CREATE TEMP TABLE pg_temp.incoming_districts ON COMMIT DROP AS
  SELECT
    item->>'city' AS city,
    item->>'name' AS name,
    nullif(item->>'osm_relation', '')::bigint AS osm_relation,
    extensions.st_multi(
      extensions.st_setsrid(
        extensions.st_geomfromgeojson(item->'geometry'), 4326)
    )::extensions.geometry(MultiPolygon, 4326) AS boundary
  FROM jsonb_array_elements(p_districts) AS item;

  IF EXISTS (SELECT 1 FROM pg_temp.incoming_districts WHERE city IS NULL OR name IS NULL) THEN
    RAISE EXCEPTION 'every district needs a city and a name' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.incoming_districts WHERE NOT extensions.st_isvalid(boundary)) THEN
    RAISE EXCEPTION 'district boundary is not a valid polygon' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.city_districts existing
  WHERE existing.city IN (SELECT DISTINCT city FROM pg_temp.incoming_districts)
    AND NOT EXISTS (
      SELECT 1 FROM pg_temp.incoming_districts incoming
      WHERE incoming.city = existing.city AND incoming.name = existing.name
    );
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  INSERT INTO public.city_districts (city, name, osm_relation, boundary, updated_at)
  SELECT city, name, osm_relation, boundary, now() FROM pg_temp.incoming_districts
  ON CONFLICT (city, name) DO UPDATE SET
    osm_relation = EXCLUDED.osm_relation,
    boundary = EXCLUDED.boundary,
    updated_at = now();
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- A boundary edit can move a row out of every district; clear the stale
  -- assignment so the backfill's point-in-polygon join is authoritative.
  UPDATE public.registry_directory_entries entries
  SET district = NULL
  WHERE entries.district IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.city_districts districts
      WHERE districts.name = entries.district
        AND extensions.st_contains(
          districts.boundary,
          extensions.st_setsrid(
            extensions.st_makepoint(entries.map_lng, entries.map_lat), 4326)
        )
    );

  RETURN jsonb_build_object('stored', v_inserted, 'removed', v_removed);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_city_districts(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_city_districts(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Place keys on the published projection.
-- ---------------------------------------------------------------------------
-- street_key is a pure function of address, so it is generated and can never
-- drift. "Kninski trg 9, Zagreb" -> "Kninski Trg"; "NIKOLE JURISICA 1/V" ->
-- "Nikole Jurisica". initcap also folds the register's inconsistent casing,
-- which would otherwise split one street into two clusters.
ALTER TABLE public.registry_directory_entries
  ADD COLUMN IF NOT EXISTS street_key text
    GENERATED ALWAYS AS (
      nullif(initcap(btrim(regexp_replace(split_part(address, ',', 1), '\s+[0-9].*$', ''))), '')
    ) STORED;

-- district needs a spatial lookup, so it is stored and maintained by the
-- projection trigger below plus a bounded backfill for the live snapshot.
ALTER TABLE public.registry_directory_entries
  ADD COLUMN IF NOT EXISTS district text;

CREATE OR REPLACE FUNCTION public.registry_district_for_point(
  p_lng double precision,
  p_lat double precision
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT districts.name
  FROM public.city_districts districts
  WHERE p_lng IS NOT NULL
    AND p_lat IS NOT NULL
    AND extensions.st_contains(
      districts.boundary,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.registry_district_for_point(double precision, double precision)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registry_district_for_point(double precision, double precision)
  TO service_role;

-- Bounded backfill so the live snapshot gains districts without a long lock,
-- and so the loader can re-run it after the boundaries change. Only rows whose
-- point actually falls in a district are touched, so it converges.
CREATE OR REPLACE FUNCTION public.backfill_registry_districts_batch(
  p_limit integer DEFAULT 2000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 2000), 10000));
  v_updated integer := 0;
BEGIN
  WITH targets AS (
    SELECT entries.batch_id, entries.udr_id, districts.name AS district
    FROM public.registry_directory_entries entries
    JOIN public.city_districts districts
      ON extensions.st_contains(
           districts.boundary,
           extensions.st_setsrid(
             extensions.st_makepoint(entries.map_lng, entries.map_lat), 4326)
         )
    WHERE entries.district IS DISTINCT FROM districts.name
      AND entries.map_lng IS NOT NULL
      AND entries.map_lat IS NOT NULL
    LIMIT v_limit
  )
  UPDATE public.registry_directory_entries entries
  SET district = targets.district
  FROM targets
  WHERE entries.batch_id = targets.batch_id
    AND entries.udr_id = targets.udr_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_updated, 'complete', v_updated = 0);
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_registry_districts_batch(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_registry_districts_batch(integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Keep district populated as new snapshots are projected.
-- ---------------------------------------------------------------------------
-- Carried over from 20260805160000_active_registry_map.sql unchanged except for
-- the district column: one indexed point-in-polygon against 17 polygons per
-- row, which is cheap next to the geocoding the same row already went through.
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
      map_lat, map_lng, map_precision, map_location, district
    ) VALUES (
      NEW.import_batch_id, NEW.udr_id, NEW.oib, NEW.naziv, NEW.skraceni_naziv,
      NEW.status, NEW.sjediste, NEW.city, NEW.zupanija, NEW.datum_upisa,
      NEW.datum_statusa, NEW.registarski_broj, NEW.oblik_udruzivanja, NEW.mail,
      NEW.web_stranica, NEW.last_verified_at, NEW.search_text, NEW.institution_id,
      v_category, v_map.latitude, v_map.longitude, v_map.location_precision,
      extensions.st_setsrid(
        extensions.st_makepoint(v_map.longitude, v_map.latitude), 4326
      )::extensions.geography,
      public.registry_district_for_point(v_map.longitude, v_map.latitude)
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
      map_location = EXCLUDED.map_location,
      district = EXCLUDED.district;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_registry_snapshot_membership()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_registry_snapshot_membership() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Place-based clustering.
-- ---------------------------------------------------------------------------
-- Two new output columns, place_kind and place_name, so the client can render
-- "Trnje - 1,134" instead of a bare count. Existing columns keep their meaning;
-- the grid fallback returns place_kind = 'grid' and a null place_name, which is
-- exactly the case the old generic label was written for.
--
-- The tier is chosen from group counts, not from zoom: zoom tells you how much
-- ground is on screen, not how many distinct places are on it, and the two come
-- apart badly between dense Zagreb and empty Lika.
DROP FUNCTION IF EXISTS public.map_association_registry_v2(double precision, double precision, double precision, double precision, integer, text[], text, boolean, boolean, text, integer, boolean);
DROP FUNCTION IF EXISTS public.map_association_registry_v1(double precision, double precision, double precision, double precision, integer, text[], text, boolean, boolean, text, integer, boolean);

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
  p_only_onboarded boolean DEFAULT false,
  p_city text DEFAULT NULL::text
)
RETURNS TABLE(
  feature_kind text, feature_id text, institution_id uuid, registry_id text,
  entity_type text, name text, category text, city text, address text,
  approximate_area text, location_precision text, latitude double precision,
  longitude double precision, accepts_donations text[], is_verified boolean,
  is_location_hidden boolean, source text, has_urgent_need boolean,
  member_count bigint, min_lng double precision, min_lat double precision,
  max_lng double precision, max_lat double precision, total_matches bigint,
  total_features bigint, place_kind text, place_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
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
      AND (NOT p_only_onboarded OR i.id IS NOT NULL)
      AND (NOT p_only_urgent OR (i.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM urgent_institutions u WHERE u.institution_id = i.id
      )))
  ), stats AS (
    SELECT
      count(*)::bigint AS matches,
      count(DISTINCT key_street)::bigint AS street_groups,
      count(DISTINCT key_district)::bigint AS district_groups,
      count(DISTINCT key_city)::bigint AS city_groups,
      count(DISTINCT key_county)::bigint AS county_groups
    FROM candidates
  ), tier AS (
    -- Finest grouping that resolves into at least two places and still fits the
    -- feature budget. Two is the floor because a single cluster covering the
    -- whole viewport tells the visitor nothing they cannot already see.
    SELECT CASE
      WHEN s.matches <= effective_limit THEN 'individual'
      WHEN s.street_groups BETWEEN 2 AND effective_limit THEN 'street'
      WHEN s.district_groups BETWEEN 2 AND effective_limit THEN 'district'
      WHEN s.city_groups BETWEEN 2 AND effective_limit THEN 'city'
      WHEN s.county_groups BETWEEN 2 AND effective_limit THEN 'county'
      ELSE 'grid'
    END AS kind
    FROM stats s
  ), place_clusters AS (
    SELECT
      t.kind AS place_kind,
      CASE t.kind
        WHEN 'street' THEN c.key_street
        WHEN 'district' THEN c.key_district
        WHEN 'city' THEN c.key_city
        ELSE c.key_county
      END AS place_name,
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
      place_kind,
      place_name,
      'place:' || place_kind || ':' || place_name AS feature_id,
      cluster_lat, cluster_lng, cluster_count,
      cluster_min_lng, cluster_min_lat, cluster_max_lng, cluster_max_lat,
      cluster_urgent
    FROM place_clusters
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
      c.place_kind,
      c.place_name
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

CREATE OR REPLACE FUNCTION public.map_association_registry_v2(
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
  p_only_onboarded boolean DEFAULT false,
  p_city text DEFAULT NULL::text
)
RETURNS TABLE(
  feature_kind text, feature_id text, institution_id uuid, registry_id text,
  entity_type text, name text, category text, city text, address text,
  approximate_area text, location_precision text, latitude double precision,
  longitude double precision, accepts_donations text[], is_verified boolean,
  is_location_hidden boolean, source text, has_urgent_need boolean,
  member_count bigint, min_lng double precision, min_lat double precision,
  max_lng double precision, max_lat double precision, total_matches bigint,
  total_features bigint, place_kind text, place_name text
)
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
    feature.total_features,
    feature.place_kind,
    feature.place_name
  FROM public.map_association_registry_v1(
    p_min_lng, p_min_lat, p_max_lng, p_max_lat, p_zoom, p_categories,
    p_donation_type, p_only_zagreb, p_only_urgent, p_query, p_limit,
    p_only_onboarded, p_city
  ) feature
  LEFT JOIN public.registry_publication_state state ON state.singleton = true
  LEFT JOIN public.registry_directory_entries directory
    ON directory.batch_id = state.current_batch_id
   AND directory.udr_id = feature.registry_id;
$function$;

REVOKE ALL ON FUNCTION public.map_association_registry_v1(
  double precision, double precision, double precision, double precision,
  integer, text[], text, boolean, boolean, text, integer, boolean, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_association_registry_v1(
  double precision, double precision, double precision, double precision,
  integer, text[], text, boolean, boolean, text, integer, boolean, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.map_association_registry_v2(
  double precision, double precision, double precision, double precision,
  integer, text[], text, boolean, boolean, text, integer, boolean, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_association_registry_v2(
  double precision, double precision, double precision, double precision,
  integer, text[], text, boolean, boolean, text, integer, boolean, text
) TO anon, authenticated, service_role;

COMMIT;
