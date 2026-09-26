-- Recompute the register map point of every directory row whose linked
-- institution is hidden.
--
-- 20260926130000 hid the non-curated domestic_violence institutions, but their
-- 14 current directory rows kept the exact DGU point they were projected with.
-- The map RPC returns registry rows at the directory point, and the
-- application only coarsens a protected row that is not already flagged
-- hidden, so the flag change briefly put those organisations back at their
-- exact seat. registry_public_map_point() already returns a hidden
-- institution's coarse public point (the snapshot capture trigger uses it, so
-- future syncs are safe); this applies it to the rows projected before the
-- flag changed.
WITH targets AS (
  SELECT d.batch_id, d.udr_id, point.latitude, point.longitude, point.location_precision
  FROM public.registry_directory_entries d
  JOIN public.registry_publication_state state
    ON state.singleton = true AND d.batch_id = state.current_batch_id
  JOIN public.institutions i ON i.id = d.institution_id
  JOIN public.ngo_registry r ON r.udr_id = d.udr_id
  CROSS JOIN LATERAL public.registry_public_map_point(
    d.udr_id, r.city, r.zupanija, r.lat, r.lng, i.id
  ) point
  WHERE coalesce(i.is_location_hidden, false)
    AND d.map_precision IS DISTINCT FROM 'hidden'
    AND point.latitude IS NOT NULL
    AND point.longitude IS NOT NULL
)
UPDATE public.registry_directory_entries d
SET map_lat = t.latitude,
    map_lng = t.longitude,
    map_precision = t.location_precision,
    map_location = extensions.st_setsrid(
      extensions.st_makepoint(t.longitude, t.latitude), 4326
    )::extensions.geography
FROM targets t
WHERE d.batch_id = t.batch_id AND d.udr_id = t.udr_id;
