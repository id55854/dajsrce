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
/** Where "near me" lands, roughly a 2–3 km radius around the visitor. */
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
 * The map draws the whole official register, 43,000+ associations, of which
 * only a small share have an account here. Colouring every pin by category
 * made those two populations indistinguishable, so a visitor could tap forty
 * pins before finding one that can actually receive anything.
 *
 * Fill now carries that distinction and the category moves to a disc inside
 * the pin, so both signals survive:
 *
 * - `registry`, in the official register, no account here. Muted.
 * - `onboarded`, has an account and can publish needs. Brand.
 * - `verified`, account plus a completed identity check. Brand plus a check.
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
/**
 * Every category except the catch-all `association`.
 *
 * `map_association_registry_v*` resolves a row's category as
 * `coalesce(institution.category, directory.category, 'association')`, so the
 * register rows the classifier never placed all arrive as `association`. Asking
 * for these twelve is therefore the same as asking for "rows that were actually
 * classified as something social", which is what the map wants by default. The
 * RPC rejects more than twelve categories, and this is exactly twelve.
 */
export const SOCIAL_MAP_CATEGORIES: InstitutionCategory[] = (
  Object.keys(CATEGORY_CONFIG) as InstitutionCategory[]
).filter((category) => category !== "association");

/**
 * The categories the map actually asks for, given what the visitor chose.
 *
 * An explicit selection always wins. With no selection the map asks for the
 * twelve classified categories, to keep the ~40,700 register rows the
 * classifier could never place out of a nationwide view.
 *
 * "On DajSrce" is the exception, and the reason this is a function. That
 * filter means "organisations with a real account here", and an account is
 * not a category: an NGO whose register row was never classified is still
 * `association`, so the classified-only default hid it. On production that
 * silently reduced the filter's answer from three organisations to one, while
 * the register's own engaged listing, which has no such default, showed all
 * three. The noise the default exists to suppress cannot occur here, because
 * every row already has a person behind it.
 *
 * A typed search is the second exception. A name or OIB is explicit intent
 * to find one organisation, and the default exists to declutter browsing, not
 * to answer "not found" for an association that is in the register: on
 * production the default hid onboarded organisations from a search for their
 * own name, and every KUD and sports club from a search for theirs. An
 * explicit category choice still narrows a search.
 *
 * Under "social only" an explicit `association` is dropped. It is the
 * catch-all every unclassified register row resolves to, so choosing "Udruga"
 * from the category menu used to reopen the ~39,000 rows the default exists to
 * hide; the social view can never answer with more than its twelve categories.
 */
export function resolveMapCategories(filters: {
  categories: InstitutionCategory[];
  onlySocial: boolean;
  onlyOnboarded: boolean;
  /** The visitor's typed name or OIB search, if any. */
  query?: string | null;
}): InstitutionCategory[] {
  if (!filters.onlySocial) return filters.categories;
  const chosen = socialCategoriesOnly(filters.categories);
  if (chosen.length > 0) return chosen;
  if (filters.onlyOnboarded || filters.query?.trim()) return [];
  return SOCIAL_MAP_CATEGORIES;
}

export function socialCategoriesOnly(
  categories: InstitutionCategory[]
): InstitutionCategory[] {
  return categories.includes("association")
    ? categories.filter((category) => category !== "association")
    : categories;
}

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

// Every pin is the same red now: category and registry/onboarded/verified
// used to each claim their own hue (a coloured disc plus a tinted fill), which
// read as two competing legends for one shape. Verified still gets its
// check-mark badge and an urgent need its flag, but those are drawn as
// overlays, not a fill change, so the map has one colour to learn.
export const PIN_STATUS_FILL: Record<MapPinStatus, string> = {
  registry: "var(--brand)",
  onboarded: "var(--brand)",
  verified: "var(--brand)",
};

/**
 * "Na DajSrcu" means a person behind the row: an approved claim or an account.
 * An institutions row alone does not qualify, because the registry promoter
 * bulk-created one (`source = 'registry'`, so trust status `registry`) for
 * every donation candidate the classifier found, and those pins were labelled
 * "Na DajSrcu" by the dozen while three associations actually had accounts.
 */
export function pinStatus(institution: PublicMapInstitution): MapPinStatus {
  if (institution.entityType !== "institution") return "registry";
  if (institution.isVerified) return "verified";
  return institution.trustStatus === "registry" ? "registry" : "onboarded";
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

/**
 * The box and zoom a map request is sent for. A fresh search or filter
 * (`national`) and any view at or beyond the national zoom ask for all of
 * Croatia, whatever part of it the screen shows. A phone at zoom 7 sees a
 * slice of the country, and county groups computed over that slice read as
 * county totals ("Istarska · 11" against 138 on a desktop); with the national
 * box every county is complete, and every visitor at that zoom shares one
 * cache key. Closer in, the request follows the viewport as before.
 */
export function requestViewport(
  viewport: { bbox: MapBounds; zoom: number },
  national: boolean
): { bbox: MapBounds; zoom: number } {
  return national || viewport.zoom <= CROATIA_INITIAL_VIEW.zoom
    ? { bbox: CROATIA_INITIAL_VIEW.bbox, zoom: CROATIA_INITIAL_VIEW.zoom }
    : { bbox: viewport.bbox, zoom: viewport.zoom };
}

export type MapQuery = {
  bbox: MapBounds;
  zoom: number;
  categories: InstitutionCategory[];
  /**
   * The kinds of help the visitor is looking for. Empty means "any". Several
   * selected means "accepts at least one of these", not "accepts all of them".
   */
  donationTypes: DonationType[];
  onlyZagreb: boolean;
  onlyUrgent: boolean;
  onlyOnboarded: boolean;
  /**
   * An exact city name from the register's own city list, not free text. The
   * map filters on equality so that picking "Zagreb" cannot also pull in the
   * neighbouring "Zagrebacka" county's rows.
   */
  city: string | null;
  query: string | null;
  limit: number;
};

export type PublicTrustStatus = "registry" | "claimed" | "contact_verified";

/**
 * How a cluster was formed. Everything except `grid` is a named place, so the
 * marker can say "Trnje" instead of reporting a count with no referent; `grid`
 * is the spatial fallback used when no naming tier resolves the viewport into
 * between two and `limit` groups.
 */
export type MapPlaceKind = "county" | "city" | "district" | "street" | "grid";

export type PublicMapCluster = {
  kind: "cluster";
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  bounds: MapBounds;
  hasUrgentNeed: boolean;
  placeKind: MapPlaceKind;
  /** Null only when `placeKind` is `grid`. */
  placeName: string | null;
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

/**
 * An OIB the visitor typed, reduced to its eleven bare digits, or null.
 *
 * The register's `search_text` already carries the OIB, so the digits alone
 * have always matched; what did not was everything a person naturally puts
 * around them. "OIB: 282-3894-9295" reaches the search as four terms, all of
 * which must match, so the one input a donor is most likely to paste from an
 * invoice or a register page returned nothing. Anything that is not exactly
 * eleven digits is left alone, so a partial number stays an ordinary
 * substring search.
 */
function normalizeOibSearch(value: string): string | null {
  const withoutLabel = value.replace(/^\s*oib\b[\s:.\-/]*/i, "");
  if (!/^[\d\s.\-/]+$/.test(withoutLabel)) return null;
  const digits = withoutLabel.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

export function normalizeMapSearch(value: string | null): string | null {
  if (value == null) return null;
  const oib = normalizeOibSearch(value);
  if (oib) return oib;
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

  // `donationTypes` is the current spelling; the singular `donationType` is
  // what every link shared before the filter became multi-select carries, so
  // both are read and merged rather than one superseding the other.
  const donationTypesInput = [
    searchParams.get("donationTypes") ?? "",
    searchParams.get("donationType") ?? "",
  ]
    .filter(Boolean)
    .join(",");
  if (donationTypesInput.length > 512) issues.push("donationTypes is too long");
  const rawDonationTypes = donationTypesInput.length <= 512
    ? donationTypesInput
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  const donationTypes = [...new Set(rawDonationTypes)];
  if (donationTypes.length > 16) issues.push("at most 16 donation types are allowed");
  for (const donationType of donationTypes) {
    if (!VALID_DONATION_TYPES.has(donationType)) {
      issues.push(`unsupported donationType: ${donationType}`);
    }
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
  const onlyOnboarded = parseBoolean(
    searchParams.get("onlyOnboarded"),
    "onlyOnboarded",
    issues
  );

  const cityInput = searchParams.get("city");
  if (cityInput != null && cityInput.length > MAP_CITY_QUERY_MAX_LENGTH) {
    issues.push(`city must not exceed ${MAP_CITY_QUERY_MAX_LENGTH} characters`);
  }
  const city =
    cityInput == null || cityInput.length > MAP_CITY_QUERY_MAX_LENGTH
      ? null
      : cityInput.trim() || null;

  if (issues.length > 0) throw new MapQueryValidationError(issues);

  return {
    bbox,
    zoom,
    categories: categories as InstitutionCategory[],
    donationTypes: donationTypes as DonationType[],
    onlyZagreb,
    onlyUrgent,
    onlyOnboarded,
    city,
    query,
    limit,
  };
}

/**
 * Grid step, in degrees, that map requests are snapped to at a zoom: a quarter
 * of a 256 px tile, i.e. 64 screen pixels at any zoom.
 */
export function mapCacheGridStep(zoom: number): number {
  return 360 / Math.pow(2, Math.trunc(zoom)) / 4;
}

/**
 * Turn a viewport into the bbox that is actually requested.
 *
 * Every pan used to produce a new five-decimal bbox (about a metre), so every
 * visitor and every nudge was its own CDN cache key and `s-maxage` never
 * matched anything: one Postgres query per pan per visitor. Snapping the edges
 * outward to a fixed grid means everyone looking at roughly the same place at
 * the same zoom shares one key, so the CDN answers all but the first of them.
 * The result is identical to the eye: clusters and pins do not change because
 * the query edge moved by less than a tile.
 *
 * Snapping only ever grows the box. If that (or the raw viewport itself, on a
 * very wide screen at a low zoom) exceeds the per-zoom area guard the API
 * enforces, the box is shrunk about its centre to fit rather than rejected.
 * The shrink is a pure function of the snapped box, so it stays shareable.
 */
export function normalizeBboxForRequest(bbox: MapBounds, zoom: number): MapBounds {
  const step = mapCacheGridStep(zoom);
  // The epsilon keeps an already grid-aligned edge on its own line despite
  // floating-point division, so normalising twice gives the same box.
  const snap = (value: number, direction: "floor" | "ceil") =>
    (direction === "floor"
      ? Math.floor(value / step + 1e-9)
      : Math.ceil(value / step - 1e-9)) * step;

  let minLng = Math.max(-180, snap(bbox[0], "floor"));
  let minLat = Math.max(-90, snap(bbox[1], "floor"));
  let maxLng = Math.min(180, snap(bbox[2], "ceil"));
  let maxLat = Math.min(90, snap(bbox[3], "ceil"));

  const maximumArea = maxBboxAreaForZoom(zoom) * 0.98;
  const area = (maxLng - minLng) * (maxLat - minLat);
  if (area > maximumArea) {
    const scale = Math.sqrt(maximumArea / area);
    const centerLng = (minLng + maxLng) / 2;
    const centerLat = (minLat + maxLat) / 2;
    const halfWidth = ((maxLng - minLng) * scale) / 2;
    const halfHeight = ((maxLat - minLat) * scale) / 2;
    // Re-snap inward so the fitted box still sits on the shared grid.
    const fittedMinLng = snap(centerLng - halfWidth, "ceil");
    const fittedMaxLng = snap(centerLng + halfWidth, "floor");
    const fittedMinLat = snap(centerLat - halfHeight, "ceil");
    const fittedMaxLat = snap(centerLat + halfHeight, "floor");
    if (fittedMinLng < fittedMaxLng && fittedMinLat < fittedMaxLat) {
      minLng = fittedMinLng;
      maxLng = fittedMaxLng;
      minLat = fittedMinLat;
      maxLat = fittedMaxLat;
    } else {
      minLng = centerLng - halfWidth;
      maxLng = centerLng + halfWidth;
      minLat = centerLat - halfHeight;
      maxLat = centerLat + halfHeight;
    }
  }

  return [minLng, minLat, maxLng, maxLat];
}

export function buildMapQueryString(query: MapQuery): string {
  const params = new URLSearchParams({
    bbox: normalizeBboxForRequest(query.bbox, query.zoom)
      .map((value) => value.toFixed(5))
      .join(","),
    zoom: String(query.zoom),
    limit: String(query.limit),
  });
  if (query.categories.length > 0) {
    params.set("categories", [...query.categories].sort().join(","));
  }
  if (query.donationTypes.length > 0) {
    params.set("donationTypes", [...query.donationTypes].sort().join(","));
  }
  if (query.onlyZagreb) params.set("onlyZagreb", "true");
  if (query.onlyUrgent) params.set("onlyUrgent", "true");
  if (query.onlyOnboarded) params.set("onlyOnboarded", "true");
  if (query.city) params.set("city", query.city);
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
  filters: Pick<
    MapQuery,
    "categories" | "donationTypes" | "city" | "onlyZagreb" | "onlyUrgent" | "onlyOnboarded"
  > & { onlySocial: boolean };
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
  if (filters.donationTypes.length > 0) {
    params.set("donationTypes", [...filters.donationTypes].sort().join(","));
  }
  if (filters.onlyZagreb) params.set("onlyZagreb", "true");
  if (filters.city) params.set("city", filters.city);
  if (filters.onlyUrgent) params.set("onlyUrgent", "true");
  if (filters.onlyOnboarded) params.set("onlyOnboarded", "true");
  // Social-only is the default, so only its absence is worth writing down.
  if (!filters.onlySocial) params.set("social", "0");
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
 * The coarse public point for a location that must not be published: a stable
 * spot inside a roughly 5 km grid cell, never the input itself. Used by the
 * list APIs for hidden institutions and, for protected categories, by the map
 * and detail projections (see `isProtectedLocation`).
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

/**
 * Categories whose exact point and street address never leave the server
 * unless a person reviewed the row (`source = 'curated'`).
 *
 * The register publishes every association's registered seat, and the
 * classifier, not the organisation, decides which of these categories a row
 * lands in. Pinning that seat under a label that reads as "a shelter is here"
 * is the risk: it may be a real shelter whose address is meant to stay
 * unknown, or a counselling office the label wrongly points someone to.
 *
 * Such a row is therefore projected exactly like an institution whose
 * location is hidden: the same stable coarse point `projectHiddenLocation`
 * gives it, no address, and `hidden` precision, so every surface that already
 * handles a hidden location (the map's area circle, the card, the detail
 * panel) treats it the same way. A curated row keeps its reviewed
 * `is_location_hidden` instead.
 */
export const PROTECTED_LOCATION_CATEGORIES: ReadonlySet<string> = new Set<InstitutionCategory>([
  "domestic_violence",
]);

export function isProtectedLocation(
  category: string | null | undefined,
  source: string | null | undefined
): boolean {
  return category != null && PROTECTED_LOCATION_CATEGORIES.has(category) && source !== "curated";
}

export function trustStatus(
  isVerified: boolean,
  source: string | null | undefined
): PublicTrustStatus {
  if (isVerified) return "contact_verified";
  if (source === "registry") return "registry";
  return "claimed";
}

/** The row shape `public_institution_detail_v1` returns, before camelCasing. */
export type PublicInstitutionDetailRpcRow = {
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
  working_hours: string | null;
  drop_off_hours: string | null;
  accepts_donations: DonationType[] | null;
  capacity: string | null;
  served_population: string | null;
  photo_url: string | null;
  is_verified: boolean | null;
  is_location_hidden: boolean | null;
  approximate_area: string | null;
  nearest_zet_stop: string | null;
  zet_lines: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Shared by the public institution page, the public detail API and the NGO's
 * own dashboard: all read the same public detail RPC and need the same
 * camelCase shape, so the mapping (and the location protection in it) lives
 * once instead of drifting between copies.
 *
 * The RPC already returns the coarse point for a hidden institution. A row in
 * a protected category that is not hidden yet is projected here the same way,
 * and a hidden location also drops its nearest tram stop, which would place it
 * to within a few hundred metres.
 */
export function toPublicInstitutionDetail(
  row: PublicInstitutionDetailRpcRow
): PublicInstitutionDetail {
  const protectedLocation =
    !row.is_location_hidden && isProtectedLocation(row.category, row.source);
  const hidden = Boolean(row.is_location_hidden) || protectedLocation;
  const point = protectedLocation
    ? projectHiddenLocation(row.id, row.latitude, row.longitude)
    : { latitude: row.latitude, longitude: row.longitude };
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    address: hidden ? null : row.address,
    city: row.city,
    latitude: point.latitude,
    longitude: point.longitude,
    phone: row.phone,
    email: row.email,
    website: row.website,
    workingHours: row.working_hours,
    dropOffHours: row.drop_off_hours,
    acceptsDonations: row.accepts_donations ?? [],
    capacity: row.capacity,
    servedPopulation: row.served_population,
    photoUrl: row.photo_url,
    isVerified: Boolean(row.is_verified),
    isLocationHidden: hidden,
    approximateArea: row.approximate_area,
    nearestZetStop: hidden ? null : row.nearest_zet_stop,
    zetLines: hidden ? null : row.zet_lines,
    trustStatus: trustStatus(Boolean(row.is_verified), row.source),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isInstitutionFeature(
  feature: PublicMapFeature
): feature is PublicMapInstitution {
  return feature.kind === "institution";
}
