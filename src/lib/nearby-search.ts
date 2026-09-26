import {
  MAP_FEATURE_LIMIT_MAX,
  buildMapQueryString,
  isInstitutionFeature,
  maxBboxAreaForZoom,
  type MapBounds,
  type PublicMapInstitution,
  type PublicMapResponse,
} from "./location-map";
import { distanceKm } from "./utils";
import type { DonationType } from "./types";

/**
 * "Which organisations near me take what I can give", answered from the same
 * bounded map API the map uses.
 *
 * The first version asked for a fixed ±0.22° box, 50 rows, one request per
 * donation type, and kept only individual pins. Around Zagreb most types match
 * far more than 50 organisations, so the API answered with place clusters and
 * the wizard showed "no results" to exactly the visitors most likely to have
 * something nearby. This search instead starts with a small box and adjusts
 * it: a clustered answer means too many matches, so it looks closer; too few
 * pins means it looks wider. Every request stays inside the public contract:
 * at most 200 features, the per-zoom area guard, a grid-snapped bbox, and all
 * selected types in one `donationTypes` request.
 */
export const NEARBY_RESULT_LIMIT = 5;

/** Degrees of latitude either side of the visitor; about 5.5 km. */
const START_RADIUS = 0.05;
/** About 90 km: from anywhere in Croatia that reaches a town. */
const MAX_RADIUS = 0.8;
/** About 550 m; below this a clustered answer is not going to resolve. */
const MIN_RADIUS = 0.005;
const MAX_REQUESTS = 6;

export type NearbySearchPage = Pick<PublicMapResponse, "features" | "meta">;

/** A zoom whose area guard and snapping grid both suit a box of this size. */
function zoomForRadius(radius: number, area: number): number {
  let zoom = Math.max(8, Math.min(17, 11 + Math.round(Math.log2(MAX_RADIUS / radius))));
  while (zoom > 6 && area > maxBboxAreaForZoom(zoom) * 0.9) zoom -= 1;
  return zoom;
}

/** The canonical map API query for a roughly square box around a point. */
export function nearbySearchQuery(
  latitude: number,
  longitude: number,
  radius: number,
  donationTypes: readonly DonationType[]
): string {
  // A degree of longitude is shorter than one of latitude here, so the box is
  // widened east-west to cover the same distance on the ground.
  const lngRadius = radius / Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
  const bbox: MapBounds = [
    Math.max(-180, longitude - lngRadius),
    Math.max(-90, latitude - radius),
    Math.min(180, longitude + lngRadius),
    Math.min(90, latitude + radius),
  ];
  const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
  return buildMapQueryString({
    bbox,
    zoom: zoomForRadius(radius, area),
    categories: [],
    donationTypes: [...donationTypes],
    onlyZagreb: false,
    onlyUrgent: false,
    onlyOnboarded: false,
    city: null,
    query: null,
    limit: MAP_FEATURE_LIMIT_MAX,
  });
}

/**
 * Individual organisations around a point that match any of the types.
 * `fetchPage` receives the query string for `/api/v1/map/institutions`.
 */
export async function findNearbyInstitutions({
  latitude,
  longitude,
  donationTypes,
  fetchPage,
}: {
  latitude: number;
  longitude: number;
  donationTypes: readonly DonationType[];
  fetchPage: (query: string) => Promise<NearbySearchPage>;
}): Promise<PublicMapInstitution[]> {
  let radius = START_RADIUS;
  // The widest box that came back as individual pins, and the narrowest one
  // that did not; the search narrows the gap between the two.
  let listed: { radius: number; institutions: PublicMapInstitution[] } | null = null;
  let tooWide: number | null = null;

  for (let request = 0; request < MAX_REQUESTS; request += 1) {
    const page = await fetchPage(nearbySearchQuery(latitude, longitude, radius, donationTypes));

    if (page.meta.mode === "clusters") {
      tooWide = tooWide === null ? radius : Math.min(tooWide, radius);
      // Aim for a box holding about half of one response, assuming matches
      // spread evenly; always shrink by at least 30 % so this converges.
      const estimate =
        radius * Math.sqrt(page.meta.limit / 2 / Math.max(1, page.meta.totalMatches));
      const next = Math.max(MIN_RADIUS, Math.min(estimate, radius * 0.7));
      if (radius <= MIN_RADIUS || (listed && next <= listed.radius * 1.1)) break;
      radius = next;
      continue;
    }

    listed = { radius, institutions: page.features.filter(isInstitutionFeature) };
    if (listed.institutions.length >= NEARBY_RESULT_LIMIT || radius >= MAX_RADIUS) break;
    const next = tooWide === null ? Math.min(MAX_RADIUS, radius * 3) : (radius + tooWide) / 2;
    if (next <= radius * 1.1) break;
    radius = next;
  }

  return listed?.institutions ?? [];
}

export type RankedInstitution = PublicMapInstitution & {
  distanceKm: number;
  /** The pin is a coarse point (hidden, city or county), not an address. */
  approximate: boolean;
};

/**
 * Organisations confirmed on DajSrce first, then everything else, each group
 * nearest first. A register row's donation types are a classifier's guess,
 * not the organisation's word, so it never outranks one that said so itself.
 */
export function rankNearbyInstitutions(
  institutions: readonly PublicMapInstitution[],
  latitude: number,
  longitude: number,
  limit = NEARBY_RESULT_LIMIT
): RankedInstitution[] {
  return institutions
    .map((institution) => ({
      ...institution,
      distanceKm: distanceKm(latitude, longitude, institution.latitude, institution.longitude),
      approximate: institution.locationPrecision !== "exact" || institution.isLocationHidden,
    }))
    .sort(
      (a, b) =>
        Number(b.isVerified) - Number(a.isVerified) || a.distanceKm - b.distanceKm
    )
    .slice(0, limit);
}

/**
 * Coordinates as they may leave the browser for reverse geocoding: two
 * decimals, about a kilometre, enough to name the neighbourhood.
 */
export function coarseCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}
