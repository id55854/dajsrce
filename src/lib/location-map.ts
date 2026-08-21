import { CATEGORY_CONFIG, DONATION_TYPES } from "@/lib/constants";
import type {
  DonationType,
  InstitutionCategory,
} from "@/lib/types";

export const MAP_API_VERSION = 2 as const;
export const MAP_FEATURE_LIMIT = 150;
export const MAP_FEATURE_LIMIT_MAX = 200;
export const MAP_LIST_RENDER_LIMIT = 60;
export const MAP_QUERY_MAX_LENGTH = 80;
export const MAP_QUERY_MAX_RAW_LENGTH = 256;
export const MAP_BBOX_MAX_AREA = 180;
export const MAP_CITY_LIMIT = 40;
export const MAP_CITY_LIMIT_MAX = 100;
export const MAP_CITY_QUERY_MAX_LENGTH = 80;

/**
 * The zoom the city picker lands on: close enough that a city resolves into
 * individual pins rather than one bubble, wide enough to hold a whole small
 * town in view.
 */
export const MAP_CITY_ZOOM = 12;
/** Where "near me" lands — roughly a 2–3 km radius around the visitor. */
export const MAP_NEARBY_ZOOM = 13;

/** One aggregate row of the public city directory. Never row-level data. */
export type PublicMapCity = {
  city: string;
  county: string;
  latitude: number;
  longitude: number;
  organisationCount: number;
};

export type PublicMapCitiesResponse = { cities: PublicMapCity[] };

/**
 * What a map pin's fill means.
 *
 * The map draws the whole official register — 43,000+ associations — of which
 * only a small share have an account here. Colouring every pin by category
 * made those two populations indistinguishable, so a visitor could tap forty
 * pins before finding one that can actually receive anything.
 *
 * Fill now carries that distinction and the category moves to a disc inside
 * the pin, so both signals survive:
 *
 * - `registry` — in the official register, no account here. Muted.
 * - `onboarded` — has an account and can publish needs. Brand.
 * - `verified` — account plus a completed identity check. Brand plus a check.
 *
 * This deliberately reinforces the rule that presence in the register is
 * neither organisational confirmation nor evidence that an organisation
 * accepts donations.
 *
 * These live here rather than beside the marker code so the legend can render
 * them without pulling Leaflet into the initial bundle.
 */
/**
 * A map feature that has no account here is identified by its official
 * register key rather than an institution UUID, and `map_association_registry_v*`
 * emits it as `'registry:' || udr_id`. Detail lookups have to split it back
 * apart, and they must do so from a URL alone, so the prefix is shared rather
 * than spelled out at each call site.
 */
export const REGISTRY_ID_PREFIX = "registry:";

export function splitRegistryFeatureId(featureId: string): string | null {
  return featureId.startsWith(REGISTRY_ID_PREFIX)
    ? featureId.slice(REGISTRY_ID_PREFIX.length)
    : null;
}

export type MapPinStatus = "registry" | "onboarded" | "verified";

export const MAP_PIN_STATUSES: readonly MapPinStatus[] = [
  "verified",
  "onboarded",
  "registry",
];

export const PIN_STATUS_FILL: Record<MapPinStatus, string> = {
  registry: "var(--ink-tertiary)",
  onboarded: "var(--brand)",
  verified: "var(--brand-strong)",
};

export function pinStatus(institution: PublicMapInstitution): MapPinStatus {
  if (institution.entityType !== "institution") return "registry";
  return institution.isVerified ? "verified" : "onboarded";
}

export function maxBboxAreaForZoom(zoom: number): number {
  return MAP_BBOX_MAX_AREA / Math.pow(2, Math.max(0, zoom - 6));
}

export const CROATIA_INITIAL_VIEW = {
  center: [45.2, 16.4] as [number, number],
  zoom: 7,
  bbox: [13.0, 42.0, 20.0, 47.0] as MapBounds,
};

export type MapBounds = [
  minLongitude: number,
  minLatitude: number,
  maxLongitude: number,
  maxLatitude: number,
];

export type MapQuery = {
  bbox: MapBounds;
  zoom: number;
  categories: InstitutionCategory[];
  donationType: DonationType | null;
  onlyZagreb: boolean;
  onlyUrgent: boolean;
  query: string | null;
  limit: number;
};

export type PublicTrustStatus = "registry" | "claimed" | "contact_verified";

export type PublicMapCluster = {
  kind: "cluster";
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  bounds: MapBounds;
  hasUrgentNeed: boolean;
};

export type PublicMapInstitution = {
  kind: "institution";
  id: string;
  entityType: "institution" | "registry";
  registryId: string | null;
  name: string;
  category: InstitutionCategory;
  city: string | null;
  address: string | null;
  approximateArea: string | null;
  latitude: number;
  longitude: number;
  acceptsDonations: DonationType[];
  isVerified: boolean;
  isLocationHidden: boolean;
  locationPrecision: "exact" | "hidden" | "city" | "county";
  trustStatus: PublicTrustStatus;
  hasUrgentNeed: boolean;
};

export type PublicMapFeature = PublicMapCluster | PublicMapInstitution;

export type PublicMapResponse = {
  version: typeof MAP_API_VERSION;
  features: PublicMapFeature[];
  meta: {
    returned: number;
    totalMatches: number;
    totalFeatures: number;
    truncated: boolean;
    mode: "clusters" | "institutions";
    limit: number;
  };
};

export type PublicInstitutionDetail = {
  id: string;
  name: string;
  category: InstitutionCategory;
  description: string;
  address: string | null;
  city: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  email: string | null;
  website: string | null;
  workingHours: string | null;
  dropOffHours: string | null;
  acceptsDonations: DonationType[];
  capacity: string | null;
  servedPopulation: string | null;
  photoUrl: string | null;
  isVerified: boolean;
  isLocationHidden: boolean;
  approximateArea: string | null;
  nearestZetStop: string | null;
  zetLines: string | null;
  trustStatus: PublicTrustStatus;
  createdAt: string;
  updatedAt: string;
};

export class MapQueryValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid map query: ${issues.join("; ")}`);
    this.name = "MapQueryValidationError";
  }
}

const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_CONFIG));
const VALID_DONATION_TYPES = new Set(Object.keys(DONATION_TYPES));

function finiteNumber(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(
  value: string | null,
  field: string,
  issues: string[]
): boolean {
  if (value == null || value === "" || value === "false" || value === "0") {
    return false;
  }
  if (value === "true" || value === "1") return true;
  issues.push(`${field} must be true or false`);
  return false;
}

export function normalizeMapSearch(value: string | null): string | null {
  if (value == null) return null;
  const normalized = value
    .normalize("NFKC")
    .replace(/[%_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("hr");
  return normalized || null;
}

export function parseMapQuery(searchParams: URLSearchParams): MapQuery {
  const issues: string[] = [];
  const bboxInput = searchParams.get("bbox") ?? "";
  const rawBbox = bboxInput.length <= 160 ? bboxInput.split(",") : [];
  if (bboxInput.length > 160) issues.push("bbox is too long");
  const bboxValues = rawBbox.map((value) => finiteNumber(value));

  if (bboxValues.length !== 4 || bboxValues.some((value) => value == null)) {
    issues.push("bbox must contain minLng,minLat,maxLng,maxLat");
  }

  const bbox = (bboxValues.length === 4 && bboxValues.every((value) => value != null)
    ? bboxValues
    : CROATIA_INITIAL_VIEW.bbox) as MapBounds;
  const [minLng, minLat, maxLng, maxLat] = bbox;

  if (minLng < -180 || maxLng > 180 || minLng >= maxLng) {
    issues.push("bbox longitude range is invalid");
  }
  if (minLat < -90 || maxLat > 90 || minLat >= maxLat) {
    issues.push("bbox latitude range is invalid");
  }
  const zoomValue = finiteNumber(searchParams.get("zoom"));
  const zoom = zoomValue == null ? Number.NaN : Math.trunc(zoomValue);
  if (!Number.isInteger(zoom) || zoom < 6 || zoom > 19) {
    issues.push("zoom must be an integer between 6 and 19");
  } else {
    const maximumArea = maxBboxAreaForZoom(zoom);
    if ((maxLng - minLng) * (maxLat - minLat) > maximumArea) {
      issues.push(
        `bbox area must not exceed ${maximumArea.toFixed(3)} square degrees at zoom ${zoom}`
      );
    }
  }

  const categoriesInput = searchParams.get("categories") ?? "";
  if (categoriesInput.length > 1024) issues.push("categories is too long");
  const rawCategories = categoriesInput.length <= 1024
    ? categoriesInput
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  const categories = [...new Set(rawCategories)];
  if (categories.length > 12) issues.push("at most 12 categories are allowed");
  for (const category of categories) {
    if (!VALID_CATEGORIES.has(category)) {
      issues.push(`unsupported category: ${category}`);
    }
  }

  const donationTypeInput = searchParams.get("donationType") ?? "";
  if (donationTypeInput.length > 64) issues.push("donationType is too long");
  const donationType = donationTypeInput.length <= 64
    ? donationTypeInput.trim() || null
    : null;
  if (donationType && !VALID_DONATION_TYPES.has(donationType)) {
    issues.push(`unsupported donationType: ${donationType}`);
  }

  const queryInput = searchParams.get("q");
  if (queryInput && queryInput.length > MAP_QUERY_MAX_RAW_LENGTH) {
    issues.push(`q input must not exceed ${MAP_QUERY_MAX_RAW_LENGTH} characters`);
  }
  const query = queryInput == null || queryInput.length <= MAP_QUERY_MAX_RAW_LENGTH
    ? normalizeMapSearch(queryInput)
    : null;
  if (query && query.length < 2) issues.push("q must contain at least 2 characters");
  if (query && query.length > MAP_QUERY_MAX_LENGTH) {
    issues.push(`q must not exceed ${MAP_QUERY_MAX_LENGTH} characters`);
  }

  const rawLimit = finiteNumber(searchParams.get("limit"));
  const limit = rawLimit == null ? MAP_FEATURE_LIMIT : Math.trunc(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAP_FEATURE_LIMIT_MAX) {
    issues.push(`limit must be between 1 and ${MAP_FEATURE_LIMIT_MAX}`);
  }

  const onlyZagreb = parseBoolean(
    searchParams.get("onlyZagreb"),
    "onlyZagreb",
    issues
  );
  const onlyUrgent = parseBoolean(
    searchParams.get("onlyUrgent"),
    "onlyUrgent",
    issues
  );

  if (issues.length > 0) throw new MapQueryValidationError(issues);

  return {
    bbox,
    zoom,
    categories: categories as InstitutionCategory[],
    donationType: donationType as DonationType | null,
    onlyZagreb,
    onlyUrgent,
    query,
    limit,
  };
}

export function buildMapQueryString(query: MapQuery): string {
  const params = new URLSearchParams({
    bbox: query.bbox.map((value) => value.toFixed(5)).join(","),
    zoom: String(query.zoom),
    limit: String(query.limit),
  });
  if (query.categories.length > 0) {
    params.set("categories", [...query.categories].sort().join(","));
  }
  if (query.donationType) params.set("donationType", query.donationType);
  if (query.onlyZagreb) params.set("onlyZagreb", "true");
  if (query.onlyUrgent) params.set("onlyUrgent", "true");
  if (query.query) params.set("q", query.query);
  return params.toString();
}

/**
 * The map lives at `/`, so its address bar is the site's front door. What the
 * API needs (a five-decimal bbox, an explicit zoom and an explicit limit) is
 * not what a shareable URL should carry, and writing all of it on every pan
 * turned `dajsrce.hr` into a 120-character query string before the visitor had
 * done anything.
 *
 * The browser URL therefore carries a single compact `@lat,lng,zoom` triple and
 * only the state the visitor actually chose. Nothing is written at all while
 * the view is still the default one, so the front door stays clean. This is a
 * presentation concern only: `buildMapQueryString` above remains the sole
 * source of the API request and its validation contract is untouched.
 */
const VIEW_PARAM = "@";
/** ~11 m at Croatian latitudes: finer than any zoom level can resolve. */
const VIEW_PRECISION = 4;

export function mapViewIsDefault(center: [number, number], zoom: number): boolean {
  const [latitude, longitude] = center;
  const [defaultLat, defaultLng] = CROATIA_INITIAL_VIEW.center;
  return (
    zoom === CROATIA_INITIAL_VIEW.zoom &&
    Math.abs(latitude - defaultLat) < 0.01 &&
    Math.abs(longitude - defaultLng) < 0.01
  );
}

export function buildBrowserMapParams({
  center,
  zoom,
  filters,
  query,
  selectedId,
}: {
  center: [number, number];
  zoom: number;
  filters: Pick<MapQuery, "categories" | "donationType" | "onlyZagreb" | "onlyUrgent">;
  query: string | null;
  selectedId: string | null;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (!mapViewIsDefault(center, zoom)) {
    params.set(
      VIEW_PARAM,
      `${center[0].toFixed(VIEW_PRECISION)},${center[1].toFixed(VIEW_PRECISION)},${zoom}`
    );
  }
  if (filters.categories.length > 0) {
    params.set("categories", [...filters.categories].sort().join(","));
  }
  if (filters.donationType) params.set("donationType", filters.donationType);
  if (filters.onlyZagreb) params.set("onlyZagreb", "true");
  if (filters.onlyUrgent) params.set("onlyUrgent", "true");
  if (query) params.set("q", query);
  if (selectedId) params.set("institution", selectedId);
  return params;
}

/**
 * Reads `@lat,lng,zoom`, and still accepts the older `bbox`+`zoom` pair so that
 * links shared before this change keep resolving to the same place.
 */
export function parseBrowserMapView(
  searchParams: URLSearchParams
): { center: [number, number]; zoom: number } {
  const compact = searchParams.get(VIEW_PARAM);
  if (compact && compact.length <= 40) {
    const [latitude, longitude, zoom] = compact.split(",").map(finiteNumber);
    if (
      latitude != null &&
      longitude != null &&
      zoom != null &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180 &&
      Number.isInteger(zoom) &&
      zoom >= 6 &&
      zoom <= 19
    ) {
      return { center: [latitude, longitude], zoom };
    }
  }

  const legacyBbox = (searchParams.get("bbox") ?? "").split(",").map(finiteNumber);
  const legacyZoom = finiteNumber(searchParams.get("zoom"));
  if (
    legacyBbox.length === 4 &&
    legacyBbox.every((value) => value != null) &&
    legacyZoom != null &&
    Number.isInteger(legacyZoom) &&
    legacyZoom >= 6 &&
    legacyZoom <= 19
  ) {
    const [minLng, minLat, maxLng, maxLat] = legacyBbox as [number, number, number, number];
    if (minLng < maxLng && minLat < maxLat) {
      return {
        center: [(minLat + maxLat) / 2, (minLng + maxLng) / 2],
        zoom: legacyZoom,
      };
    }
  }

  return { center: CROATIA_INITIAL_VIEW.center, zoom: CROATIA_INITIAL_VIEW.zoom };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Compatibility projection used only while the indexed RPC migration is not
 * yet deployed. It never serializes a hidden institution's exact coordinate.
 */
export function projectHiddenLocation(
  id: string,
  latitude: number,
  longitude: number
): { latitude: number; longitude: number } {
  const gridSize = 0.05;
  const latBase = Math.floor((latitude + 90) / gridSize) * gridSize - 90;
  const lngBase = Math.floor((longitude + 180) / gridSize) * gridSize - 180;
  const latOffset = 0.01 + (stableHash(`${id}:lat`) % 3000) / 100_000;
  const lngOffset = 0.01 + (stableHash(`${id}:lng`) % 3000) / 100_000;
  let projectedLatitude = Number((latBase + latOffset).toFixed(6));
  const projectedLongitude = Number((lngBase + lngOffset).toFixed(6));
  if (projectedLatitude === latitude && projectedLongitude === longitude) {
    projectedLatitude = Number(
      (projectedLatitude + (latOffset <= 0.034 ? 0.005 : -0.005)).toFixed(6)
    );
  }
  return { latitude: projectedLatitude, longitude: projectedLongitude };
}

export function trustStatus(
  isVerified: boolean,
  source: string | null | undefined
): PublicTrustStatus {
  if (isVerified) return "contact_verified";
  if (source === "registry") return "registry";
  return "claimed";
}

export function isInstitutionFeature(
  feature: PublicMapFeature
): feature is PublicMapInstitution {
  return feature.kind === "institution";
}
