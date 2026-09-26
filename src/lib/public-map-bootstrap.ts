import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { buildMapQueryString, parseMapQuery, type MapQuery } from "@/lib/location-map";
import { loadPublicMap } from "@/lib/public-map-data";
import { logError } from "@/lib/observability";
import type { MapBootstrap } from "@/app/map/map-state";

// Only public, bounded projections enter this cache. No cookies, identity or
// private data. Match the existing API's five-minute freshness window. The
// key is versioned with the projection: v2 withholds protected-category
// locations, and a snapshot cached under the old projection must never be
// served again, not even once as a stale copy.
const cachedMap = unstable_cache(async (queryKey: string) => {
  const query = parseMapQuery(new URLSearchParams(queryKey));
  return (await loadPublicMap(query)).response;
}, ["public-map-bootstrap-v2"], { revalidate: 300 });

/**
 * How long the home page may wait for the snapshot before sending HTML
 * without it. A data-cache hit fits comfortably; a miss runs the map RPC,
 * which takes one to several seconds, and holding the whole page (and every
 * client-side navigation to `/`) behind it is slower than letting the browser
 * fetch its own viewport, which it does anyway.
 */
export const MAP_BOOTSTRAP_BUDGET_MS = 250;

export async function getMapBootstrap(
  query: MapQuery,
  budgetMs = MAP_BOOTSTRAP_BUDGET_MS
): Promise<MapBootstrap | null> {
  const queryKey = buildMapQueryString(query);
  const pending = cachedMap(queryKey);
  // Failed requests must not become cached empty lists. The browser retains
  // its ordinary retry/error path if the server could not get a first view.
  const settled = pending.catch((error: unknown) => {
    logError("public_map_bootstrap_failed", error);
    return null;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const overBudget = new Promise<"over_budget">((resolve) => {
    timer = setTimeout(() => resolve("over_budget"), budgetMs);
  });

  try {
    const response = await Promise.race([settled, overBudget]);
    if (response === "over_budget") {
      // Let the query finish after the response so the next visitor gets a
      // cache hit. Outside a request scope (tests, scripts) there is nothing
      // to extend, and the promise already cannot reject unhandled.
      try {
        after(() => settled);
      } catch {
        // No request scope.
      }
      return null;
    }
    return response ? { queryKey, response } : null;
  } finally {
    clearTimeout(timer);
  }
}
