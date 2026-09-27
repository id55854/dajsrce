import type { MapFilters, MapViewport } from "@/components/Map";
import {
  MAP_FEATURE_LIMIT,
  buildMapQueryString,
  requestViewport,
  resolveMapCategories,
  socialCategoriesOnly,
  type MapQuery,
  maxBboxAreaForZoom,
  parseBrowserMapView,
  parseMapQuery,
  type MapBounds,
  type PublicMapResponse,
} from "@/lib/location-map";

export const DEFAULT_FILTERS: MapFilters = {
  categories: [],
  donationTypes: [],
  city: null,
  onlyZagreb: false,
  onlyUrgent: false,
  onlyOnboarded: false,
};

export type MapMeta = PublicMapResponse["meta"];

export function defaultMeta(): MapMeta {
  return {
    returned: 0,
    totalMatches: 0,
    totalFeatures: 0,
    truncated: false,
    mode: "clusters",
    limit: MAP_FEATURE_LIMIT,
  };
}

/**
 * A well-formed stand-in for the viewport the map has not reported yet.
 *
 * It is never sent to the API; the first request waits for the map's own
 * bounds (see `viewportReady`), but `mapQuery` has to be a valid `MapQuery`
 * from the first render, and the initial `flyTo`-free centring needs a centre.
 * The clamp keeps it inside the same per-zoom area guard the API enforces, so
 * it stays valid even if it ever were sent.
 */
function approximateBbox(center: [number, number], zoom: number): MapBounds {
  const [latitude, longitude] = center;
  const spanLng = (360 / Math.pow(2, zoom)) * 4;
  const spanLat = spanLng * 0.75 * Math.cos((latitude * Math.PI) / 180);
  const maximumArea = maxBboxAreaForZoom(zoom) * 0.9;
  const scale = Math.min(
    1,
    Math.sqrt(maximumArea / Math.max(spanLng * spanLat, Number.EPSILON))
  );
  const halfLng = (spanLng * scale) / 2;
  const halfLat = (spanLat * scale) / 2;
  return [
    Math.max(-180, longitude - halfLng),
    Math.max(-90, latitude - halfLat),
    Math.min(180, longitude + halfLng),
    Math.min(90, latitude + halfLat),
  ];
}

export function initialState(searchParams: URLSearchParams): {
  center: [number, number];
  viewport: MapViewport;
  filters: MapFilters;
  search: string;
  selectedId: string | null;
} {
  const { center, zoom } = parseBrowserMapView(searchParams);
  const bbox = approximateBbox(center, zoom);

  // Filters and search still travel as their own readable parameters; only the
  // viewport moved to the compact `@lat,lng,zoom` form. Feeding the validator a
  // synthesized bbox/zoom lets it stay the single place those are validated.
  const params = new URLSearchParams(searchParams);
  params.set("bbox", bbox.join(","));
  params.set("zoom", String(zoom));
  params.set("limit", String(MAP_FEATURE_LIMIT));

  try {
    const parsed = parseMapQuery(params);
    return {
      center,
      viewport: { bbox, zoom },
      filters: {
        // An older link can still carry `association` (or `social=0`, which is
        // ignored now); the platform shows social associations only.
        categories: socialCategoriesOnly(parsed.categories),
        donationTypes: parsed.donationTypes,
        city: parsed.city,
        onlyZagreb: parsed.onlyZagreb,
        onlyUrgent: parsed.onlyUrgent,
        onlyOnboarded: parsed.onlyOnboarded,
      },
      search: params.get("q") ?? "",
      selectedId: params.get("institution"),
    };
  } catch {
    return {
      center,
      viewport: { bbox, zoom },
      filters: DEFAULT_FILTERS,
      search: "",
      selectedId: null,
    };
  }
}

/** Same default filters and national search semantics as the interactive map. */
export function initialMapQuery(params: URLSearchParams): MapQuery {
  const state = initialState(params);
  const search = state.search.trim();
  const typed = search.length >= 2 ? search : null;
  const query: MapQuery = {
    ...state.viewport,
    ...state.filters,
    categories: resolveMapCategories(state.filters.categories),
    query: typed,
    limit: MAP_FEATURE_LIMIT,
    ...requestViewport(state.viewport, Boolean(typed)),
  };
  // Match the normalized browser/API request, and validate before any DB work.
  return parseMapQuery(new URLSearchParams(buildMapQueryString(query)));
}

export type MapBootstrap = {
  queryKey: string;
  response: PublicMapResponse;
};
