import { permanentRedirect } from "next/navigation";

/**
 * `/map` moved to `/`. Existing links, bookmarks, shared viewports and the
 * indexed URL all keep working through a 308, and their query string travels
 * with them — `/map?@45.81,15.97,13&onlyUrgent=true` and the older
 * `bbox=…&zoom=…` form both land on the same view. `parseBrowserMapView`
 * still reads the legacy pair.
 */
export default async function MapRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") {
      query.set(key, value);
    } else if (Array.isArray(value) && typeof value[0] === "string") {
      query.set(key, value[0]);
    }
  }
  const search = query.toString();
  permanentRedirect(search ? `/?${search}` : "/");
}
