import { describe, expect, it, vi } from "vitest";
import {
  coarseCoordinate,
  findNearbyInstitutions,
  nearbySearchQuery,
  rankNearbyInstitutions,
  type NearbySearchPage,
} from "./nearby-search";
import { maxBboxAreaForZoom, parseMapQuery, type PublicMapInstitution } from "./location-map";

const ZAGREB = { latitude: 45.8131, longitude: 15.9775 };

function institution(id: string, latitude: number, longitude: number, extra: Partial<PublicMapInstitution> = {}): PublicMapInstitution {
  return {
    kind: "institution",
    id,
    entityType: "institution",
    registryId: null,
    name: id,
    category: "association",
    city: "Zagreb",
    address: "Ilica 1",
    approximateArea: null,
    latitude,
    longitude,
    acceptsDonations: ["clothes"],
    isVerified: false,
    isLocationHidden: false,
    locationPrecision: "exact",
    trustStatus: "registry",
    hasUrgentNeed: false,
    ...extra,
  };
}

/** Half the box height, in degrees of latitude, from a query string. */
function radiusOf(query: string): number {
  const [, minLat, , maxLat] = new URLSearchParams(query).get("bbox")!.split(",").map(Number);
  return (maxLat - minLat) / 2;
}

function clusters(totalMatches: number): NearbySearchPage {
  return {
    features: [],
    meta: { returned: 9, totalMatches, totalFeatures: 9, truncated: false, mode: "clusters", limit: 200 },
  };
}

function pins(count: number): NearbySearchPage {
  const features = Array.from({ length: count }, (_, index) =>
    institution(`i${index}`, ZAGREB.latitude + index * 0.001, ZAGREB.longitude)
  );
  return {
    features,
    meta: { returned: count, totalMatches: count, totalFeatures: count, truncated: false, mode: "institutions", limit: 200 },
  };
}

describe("nearbySearchQuery", () => {
  it("builds one valid, snapped, capped request for all selected types", () => {
    for (const radius of [0.005, 0.05, 0.15, 0.45, 0.8]) {
      const query = nearbySearchQuery(ZAGREB.latitude, ZAGREB.longitude, radius, ["hygiene", "clothes"]);
      const params = new URLSearchParams(query);
      // The API's own parser accepts it, so the area guard holds at the zoom picked.
      const parsed = parseMapQuery(params);
      const [minLng, minLat, maxLng, maxLat] = parsed.bbox;
      expect((maxLng - minLng) * (maxLat - minLat)).toBeLessThanOrEqual(maxBboxAreaForZoom(parsed.zoom));
      expect(parsed.limit).toBe(200);
      expect(params.get("donationTypes")).toBe("clothes,hygiene");
      expect(params.get("donationType")).toBeNull();
      // The box still contains the visitor.
      expect(minLat).toBeLessThan(ZAGREB.latitude);
      expect(maxLng).toBeGreaterThan(ZAGREB.longitude);
    }
  });
});

describe("findNearbyInstitutions", () => {
  it("looks closer when the first box has more matches than one response carries", async () => {
    const fetchPage = vi.fn(async (query: string) => (radiusOf(query) > 0.035 ? clusters(372) : pins(80)));
    const found = await findNearbyInstitutions({ ...ZAGREB, donationTypes: ["medical_supplies"], fetchPage });
    expect(found).toHaveLength(80);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("looks wider when too few organisations are nearby", async () => {
    const fetchPage = vi.fn(async (query: string) => (radiusOf(query) < 0.3 ? pins(1) : pins(7)));
    const found = await findNearbyInstitutions({ ...ZAGREB, donationTypes: ["food"], fetchPage });
    expect(found).toHaveLength(7);
    expect(fetchPage.mock.calls.length).toBeGreaterThan(1);
  });

  it("backs off between a box that listed too few and one that clustered", async () => {
    const fetchPage = vi.fn(async (query: string) => {
      const radius = radiusOf(query);
      if (radius > 0.12) return clusters(400);
      return radius > 0.06 ? pins(40) : pins(2);
    });
    const found = await findNearbyInstitutions({ ...ZAGREB, donationTypes: ["clothes"], fetchPage });
    expect(found).toHaveLength(40);
  });

  it("stops within the request budget and never asks for more than 200 features", async () => {
    const fetchPage = vi.fn(async () => clusters(100_000));
    const found = await findNearbyInstitutions({ ...ZAGREB, donationTypes: ["clothes"], fetchPage });
    expect(found).toEqual([]);
    expect(fetchPage.mock.calls.length).toBeLessThanOrEqual(6);
    for (const [query] of fetchPage.mock.calls as unknown as [string][]) {
      expect(new URLSearchParams(query).get("limit")).toBe("200");
    }
  });

  it("returns nothing, not an error, where nothing matches at all", async () => {
    const fetchPage = vi.fn(async () => pins(0));
    expect(await findNearbyInstitutions({ ...ZAGREB, donationTypes: ["furniture"], fetchPage })).toEqual([]);
  });
});

describe("rankNearbyInstitutions", () => {
  it("puts organisations confirmed on DajSrce first, then by distance", () => {
    const near = institution("near-registry", ZAGREB.latitude + 0.001, ZAGREB.longitude);
    const far = institution("far-verified", ZAGREB.latitude + 0.05, ZAGREB.longitude, {
      isVerified: true,
      trustStatus: "contact_verified",
    });
    const middle = institution("middle-registry", ZAGREB.latitude + 0.01, ZAGREB.longitude, {
      locationPrecision: "city",
    });
    const ranked = rankNearbyInstitutions([middle, near, far], ZAGREB.latitude, ZAGREB.longitude);
    expect(ranked.map((row) => row.id)).toEqual(["far-verified", "near-registry", "middle-registry"]);
    expect(ranked.map((row) => row.approximate)).toEqual([false, false, true]);
    expect(ranked[1].distanceKm).toBeCloseTo(0.11, 1);
  });

  it("caps the list", () => {
    const rows = Array.from({ length: 12 }, (_, index) => institution(`i${index}`, ZAGREB.latitude, ZAGREB.longitude));
    expect(rankNearbyInstitutions(rows, ZAGREB.latitude, ZAGREB.longitude)).toHaveLength(5);
  });
});

describe("coarseCoordinate", () => {
  it("keeps two decimals, about a kilometre", () => {
    expect(coarseCoordinate(45.81312)).toBe(45.81);
    expect(coarseCoordinate(15.97751)).toBe(15.98);
  });
});
