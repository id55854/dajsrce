-- Restore the public city directory.
--
-- `registry_map_cities_v1` backs the map's "choose a city" affordance, for
-- visitors who decline or cannot use geolocation. It was written in
-- `20260812100000_map_coarse_clusters_city_directory.sql`, but that migration
-- never reached this database: every other object it defines
-- (`map_association_registry_v1`) was recreated by `20260821120000` and
-- `20260822160000`, so the gap left no trace except a `/api/v1/map/cities`
-- endpoint that has answered PGRST202 -- "no matches were found in the schema
-- cache" -- for every visitor since.
--
-- The original file cannot simply be replayed now. Its
-- `map_association_registry_v1` predates both `p_only_onboarded` and `p_city`,
-- so applying it out of order would create an eleven-argument overload beside
-- the live thirteen-argument function. The map route omits both optional
-- arguments on a default view, which is exactly eleven named parameters, so
-- PostgREST would start resolving ordinary map requests to the stale grid
-- clustering. Restoring only the missing function is the safe half.
--
-- The definition below is character-for-character the one from
-- `20260812100000`. It is still correct against the current schema: every
-- column it reads (`registry_directory_entries.city`/`.county`/`.batch_id`,
-- `registry_publication_state.singleton`/`.current_batch_id`,
-- `registry_location_centroids.city_key`/`.county_key`) is unchanged, and the
-- later migrations that touched that table only added columns.
--
-- Aggregate-only, as before: a city label, its county, the precomputed median
-- point and a count of published organisations. No row-level location or
-- identity crosses this boundary, which is what makes it safe for anon.

BEGIN;
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

-- PostgREST caches the function catalogue; without this the endpoint keeps
-- answering PGRST202 until the next unrelated DDL event.
NOTIFY pgrst, 'reload schema';
