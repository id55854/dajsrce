import type { MapFilters, MapViewport } from "@/components/Map";
import {
  MAP_FEATURE_LIMIT,
  CROATIA_INITIAL_VIEW,
  buildMapQueryString,
  resolveMapCategories,
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
  // On by default: the register is mostly sports, culture and hobby
  // associations, and a first-time visitor looking for somewhere to help
  // should not have to filter those out before the map means anything.
  onlySocial: true,
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
        categories: parsed.categories,
        donationTypes: parsed.donationTypes,
        city: parsed.city,
        onlyZagreb: parsed.onlyZagreb,
        onlyUrgent: parsed.onlyUrgent,
        onlyOnboarded: parsed.onlyOnboarded,
        onlySocial: params.get("social") !== "0",
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
  const query: MapQuery = {
    ...state.viewport,
    ...state.filters,
    categories: resolveMapCategories(state.filters),
    query: search.length >= 2 ? search : null,
    limit: MAP_FEATURE_LIMIT,
  };
  if (query.query) {
    query.bbox = CROATIA_INITIAL_VIEW.bbox;
    query.zoom = CROATIA_INITIAL_VIEW.zoom;
  }
  // Match the normalized browser/API request, and validate before any DB work.
  return parseMapQuery(new URLSearchParams(buildMapQueryString(query)));
}

export type MapBootstrap = {
  queryKey: string;
  response: PublicMapResponse;
};
