import { unstable_cache } from "next/cache";
import { buildMapQueryString, parseMapQuery, type MapQuery } from "@/lib/location-map";
import { loadPublicMap } from "@/lib/public-map-data";
import { logError } from "@/lib/observability";
import type { MapBootstrap } from "@/app/map/map-state";

// Only public, bounded projections enter this cache. No cookies, identity or
// private data. Match the existing API's five-minute freshness window.
const cachedMap = unstable_cache(async (queryKey: string) => {
  const query = parseMapQuery(new URLSearchParams(queryKey));
  return (await loadPublicMap(query)).response;
}, ["public-map-bootstrap-v1"], { revalidate: 300 });

export async function getMapBootstrap(query: MapQuery): Promise<MapBootstrap | null> {
  const queryKey = buildMapQueryString(query);
  try {
    return { queryKey, response: await cachedMap(queryKey) };
  } catch (error) {
    // Failed requests must not become cached empty lists. The browser retains
    // its ordinary retry/error path if the server could not get a first view.
    logError("public_map_bootstrap_failed", error);
    return null;
  }
}
