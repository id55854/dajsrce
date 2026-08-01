-- Nationwide location fast path.
--
-- Adds indexed spatial/search columns and two SECURITY DEFINER functions whose
-- return types are deliberately public-safe. Exact coordinates remain in the
-- institutions table for authorised operational use, while every public map
-- and detail response uses public_lat/public_lng. Hidden institutions are
-- assigned a stable point inside a roughly 5 km grid cell; the exact point is
-- never returned by these functions.

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
-- Migration 014 may already have installed pg_trgm in public. Leaving its
-- schema unchanged keeps this migration valid both on upgraded and fresh DBs.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS public_lat double precision,
  ADD COLUMN IF NOT EXISTS public_lng double precision;

-- Defaults are recalculated whenever an institution's exact point or hidden
-- status changes. The hash-derived offset is stable, remains inside the coarse
-- cell and avoids publishing the cell centre for every sensitive institution.
CREATE OR REPLACE FUNCTION public.set_institution_public_location()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  grid_size constant double precision := 0.05;
  lat_offset double precision;
  lng_offset double precision;
BEGIN
  IF NEW.is_location_hidden THEN
    lat_offset := 0.01 + (
      mod(abs(hashtextextended(NEW.id::text || ':lat', 0)::numeric), 3000)::double precision
      / 100000.0
    );
    lng_offset := 0.01 + (
      mod(abs(hashtextextended(NEW.id::text || ':lng', 0)::numeric), 3000)::double precision
      / 100000.0
    );
    NEW.public_lat := floor((NEW.lat + 90.0) / grid_size) * grid_size - 90.0 + lat_offset;
    NEW.public_lng := floor((NEW.lng + 180.0) / grid_size) * grid_size - 180.0 + lng_offset;
    -- Make the privacy invariant absolute even in the unlikely event that the
    -- source point already equals the hash-derived display point.
    IF NEW.public_lat = NEW.lat AND NEW.public_lng = NEW.lng THEN
      NEW.public_lat := NEW.public_lat + CASE
        WHEN lat_offset <= 0.034 THEN 0.005
        ELSE -0.005
      END;
    END IF;
  ELSE
    NEW.public_lat := NEW.lat;
    NEW.public_lng := NEW.lng;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS institutions_public_location_trigger ON public.institutions;
CREATE TRIGGER institutions_public_location_trigger
  BEFORE INSERT OR UPDATE OF lat, lng, is_location_hidden
  ON public.institutions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_institution_public_location();

-- Fire the trigger for existing rows in a single idempotent backfill.
UPDATE public.institutions
SET lat = lat
WHERE public_lat IS NULL
   OR public_lng IS NULL
   OR (NOT is_location_hidden AND (public_lat IS DISTINCT FROM lat OR public_lng IS DISTINCT FROM lng));

ALTER TABLE public.institutions
  ALTER COLUMN public_lat SET NOT NULL,
  ALTER COLUMN public_lng SET NOT NULL;

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS location extensions.geography(Point, 4326)
    GENERATED ALWAYS AS (
      extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
    ) STORED;

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS public_location extensions.geography(Point, 4326)
    GENERATED ALWAYS AS (
      extensions.st_setsrid(
        extensions.st_makepoint(public_lng, public_lat), 4326
      )::extensions.geography
    ) STORED;

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS search_text text
    GENERATED ALWAYS AS (
      lower(
        coalesce(name, '') || ' ' ||
        coalesce(description, '') || ' ' ||
        CASE
          WHEN coalesce(is_location_hidden, false) THEN ''
          ELSE coalesce(address, '')
        END || ' ' ||
        coalesce(city, '') || ' ' ||
        coalesce(approximate_area, '')
      )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_institutions_location_gist
  ON public.institutions USING gist (location);

CREATE INDEX IF NOT EXISTS idx_institutions_public_location_gist
  ON public.institutions USING gist (public_location);

-- Keeps the temporary PostgREST deployment bridge bounded and index-assisted
-- until every application instance sees the RPC in its schema cache.
CREATE INDEX IF NOT EXISTS idx_institutions_public_bbox
  ON public.institutions (public_lng, public_lat);

CREATE INDEX IF NOT EXISTS idx_institutions_search_trgm
  ON public.institutions USING gin (search_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_institutions_public_filters
  ON public.institutions (category, is_verified, city);

CREATE INDEX IF NOT EXISTS idx_needs_active_urgent_institution
  ON public.needs (institution_id)
  WHERE urgency = 'urgent' AND is_fulfilled = false;

-- At zoom levels below 12 the function returns stable grid clusters. At higher
-- zoom it returns individual public-safe points. Both modes include the total
-- feature count so the HTTP layer can state truncation explicitly.
CREATE OR REPLACE FUNCTION public.map_institutions_v1(
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
  name text,
  category text,
  city text,
  address text,
  approximate_area text,
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
  grid_size double precision;
  normalized_query text;
  bbox_area double precision := (p_max_lng - p_min_lng) * (p_max_lat - p_min_lat);
  maximum_bbox_area double precision;
BEGIN
  -- Reject oversized direct-RPC input before applying regular expressions or
  -- executing any spatial query. The HTTP route has the same limits, but this
  -- function is also callable through PostgREST.
  IF length(coalesce(p_query, '')) > 256 THEN
    RAISE EXCEPTION 'search query input is too long';
  END IF;

  IF length(coalesce(p_donation_type, '')) > 64 THEN
    RAISE EXCEPTION 'donation type input is too long';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(coalesce(p_categories, ARRAY[]::text[])) AS category_value
    WHERE length(category_value) > 64
  ) THEN
    RAISE EXCEPTION 'category input is too long';
  END IF;

  normalized_query := nullif(
    trim(regexp_replace(replace(replace(lower(coalesce(p_query, '')), '%', ' '), '_', ' '), '[[:space:]]+', ' ', 'g')),
    ''
  );

  IF p_min_lng IS NULL OR p_min_lat IS NULL
     OR p_max_lng IS NULL OR p_max_lat IS NULL
     OR p_min_lng < -180 OR p_max_lng > 180
     OR p_min_lat < -90 OR p_max_lat > 90
     OR p_min_lng >= p_max_lng OR p_min_lat >= p_max_lat THEN
    RAISE EXCEPTION 'invalid bounding box';
  END IF;

  IF p_zoom IS NULL OR p_zoom < 6 OR p_zoom > 19 THEN
    RAISE EXCEPTION 'zoom must be between 6 and 19';
  END IF;

  maximum_bbox_area := 180.0 / power(2.0, greatest(0, p_zoom - 6));
  IF bbox_area > maximum_bbox_area THEN
    RAISE EXCEPTION 'bounding box is too large for zoom level';
  END IF;

  IF coalesce(cardinality(p_categories), 0) > 12 THEN
    RAISE EXCEPTION 'too many categories';
  END IF;

  IF normalized_query IS NOT NULL
     AND (length(normalized_query) < 2 OR length(normalized_query) > 80) THEN
    RAISE EXCEPTION 'invalid search query length';
  END IF;

  -- Text search returns named rows even from the national view so the client
  -- can present an accessible result list without loading the catalogue.
  IF p_zoom < 12 AND normalized_query IS NULL THEN
    grid_size := CASE
      WHEN p_zoom <= 5 THEN 1.0
      WHEN p_zoom <= 7 THEN 0.5
      WHEN p_zoom <= 9 THEN 0.2
      WHEN p_zoom <= 10 THEN 0.1
      ELSE 0.05
    END;

    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT
        i.id,
        i.public_lat,
        i.public_lng,
        EXISTS (
          SELECT 1
          FROM public.needs n
          WHERE n.institution_id = i.id
            AND n.urgency = 'urgent'
            AND n.is_fulfilled = false
        ) AS urgent
      FROM public.institutions i
      WHERE extensions.st_intersects(
          i.public_location,
          extensions.st_makeenvelope(
            p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326
          )::extensions.geography
        )
        AND (coalesce(cardinality(p_categories), 0) = 0 OR i.category = ANY(p_categories))
        AND (p_donation_type IS NULL OR i.accepts_donations @> ARRAY[p_donation_type])
        AND (NOT p_only_zagreb OR lower(i.city) = 'zagreb' OR lower(i.city) LIKE 'zagreb %')
        AND (normalized_query IS NULL OR i.search_text ILIKE '%' || normalized_query || '%')
        AND (
          NOT p_only_urgent OR EXISTS (
            SELECT 1
            FROM public.needs n
            WHERE n.institution_id = i.id
              AND n.urgency = 'urgent'
              AND n.is_fulfilled = false
          )
        )
    ), clusters AS (
      SELECT
        floor(public_lng / grid_size)::bigint AS cell_x,
        floor(public_lat / grid_size)::bigint AS cell_y,
        avg(public_lat) AS cluster_lat,
        avg(public_lng) AS cluster_lng,
        count(*)::bigint AS cluster_count,
        min(public_lng) AS cluster_min_lng,
        min(public_lat) AS cluster_min_lat,
        max(public_lng) AS cluster_max_lng,
        max(public_lat) AS cluster_max_lat,
        bool_or(urgent) AS cluster_urgent
      FROM filtered
      GROUP BY cell_x, cell_y
    ), counted AS (
      SELECT
        c.*,
        sum(c.cluster_count) OVER ()::bigint AS all_matches,
        count(*) OVER ()::bigint AS all_features
      FROM clusters c
    )
    SELECT
      'cluster'::text,
      'cluster:' || p_zoom::text || ':' || c.cell_x::text || ':' || c.cell_y::text,
      NULL::uuid,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      c.cluster_lat::double precision,
      c.cluster_lng::double precision,
      ARRAY[]::text[],
      false,
      false,
      NULL::text,
      c.cluster_urgent,
      c.cluster_count,
      c.cluster_min_lng::double precision,
      c.cluster_min_lat::double precision,
      c.cluster_max_lng::double precision,
      c.cluster_max_lat::double precision,
      c.all_matches,
      c.all_features
    FROM counted c
    ORDER BY c.cluster_count DESC, c.cell_x, c.cell_y
    LIMIT effective_limit;
  ELSE
    RETURN QUERY
    WITH filtered AS MATERIALIZED (
      SELECT
        i.*,
        EXISTS (
          SELECT 1
          FROM public.needs n
          WHERE n.institution_id = i.id
            AND n.urgency = 'urgent'
            AND n.is_fulfilled = false
        ) AS urgent
      FROM public.institutions i
      WHERE extensions.st_intersects(
          i.public_location,
          extensions.st_makeenvelope(
            p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326
          )::extensions.geography
        )
        AND (coalesce(cardinality(p_categories), 0) = 0 OR i.category = ANY(p_categories))
        AND (p_donation_type IS NULL OR i.accepts_donations @> ARRAY[p_donation_type])
        AND (NOT p_only_zagreb OR lower(i.city) = 'zagreb' OR lower(i.city) LIKE 'zagreb %')
        AND (normalized_query IS NULL OR i.search_text ILIKE '%' || normalized_query || '%')
        AND (
          NOT p_only_urgent OR EXISTS (
            SELECT 1
            FROM public.needs n
            WHERE n.institution_id = i.id
              AND n.urgency = 'urgent'
              AND n.is_fulfilled = false
          )
        )
    ), counted AS (
      SELECT
        f.*,
        count(*) OVER ()::bigint AS all_matches
      FROM filtered f
    )
    SELECT
      'institution'::text,
      c.id::text,
      c.id,
      c.name,
      c.category,
      c.city,
      CASE WHEN c.is_location_hidden THEN NULL ELSE c.address END,
      c.approximate_area,
      c.public_lat,
      c.public_lng,
      coalesce(c.accepts_donations, ARRAY[]::text[]),
      coalesce(c.is_verified, false),
      coalesce(c.is_location_hidden, false),
      c.source,
      c.urgent,
      1::bigint,
      c.public_lng,
      c.public_lat,
      c.public_lng,
      c.public_lat,
      c.all_matches,
      c.all_matches
    FROM counted c
    ORDER BY c.urgent DESC, c.is_verified DESC, c.name, c.id
    LIMIT effective_limit;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_institution_detail_v1(p_id uuid)
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
  updated_at timestamptz
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
    i.updated_at
  FROM public.institutions i
  WHERE i.id = p_id;
$$;

REVOKE ALL ON FUNCTION public.map_institutions_v1(
  double precision, double precision, double precision, double precision,
  integer, text[], text, boolean, boolean, text, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_institutions_v1(
  double precision, double precision, double precision, double precision,
  integer, text[], text, boolean, boolean, text, integer
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.public_institution_detail_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_institution_detail_v1(uuid)
  TO anon, authenticated, service_role;

COMMIT;
