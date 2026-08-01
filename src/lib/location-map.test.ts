import { describe, expect, it } from "vitest";
import {
  MAP_BBOX_MAX_AREA,
  MAP_FEATURE_LIMIT,
  MAP_LIST_RENDER_LIMIT,
  MapQueryValidationError,
  buildMapQueryString,
  normalizeMapSearch,
  parseMapQuery,
  projectHiddenLocation,
  type PublicMapResponse,
} from "@/lib/location-map";

function validParams() {
  return new URLSearchParams({
    bbox: "13,42,20,47",
    zoom: "7",
  });
}

describe("map query contract", () => {
  it("normalizes, validates and bounds a public map query", () => {
    const params = validParams();
    params.set("categories", "soup_kitchen,caritas,soup_kitchen");
    params.set("donationType", "food");
    params.set("onlyUrgent", "true");
    params.set("q", "  Pučka%__ KUHINJA  ");

    expect(parseMapQuery(params)).toEqual({
      bbox: [13, 42, 20, 47],
      zoom: 7,
      categories: ["soup_kitchen", "caritas"],
      donationType: "food",
      onlyZagreb: false,
      onlyUrgent: true,
      query: "pučka kuhinja",
      limit: MAP_FEATURE_LIMIT,
    });
  });

  it("rejects unbounded, invalid and excessive requests", () => {
    expect(() => parseMapQuery(new URLSearchParams({ zoom: "7" }))).toThrow(
      /Invalid map query/
    );
    try {
      parseMapQuery(
        new URLSearchParams({ bbox: "-180,-90,180,90", zoom: "6" })
      );
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MapQueryValidationError);
      expect((error as MapQueryValidationError).issues).toContain(
        `bbox area must not exceed ${MAP_BBOX_MAX_AREA.toFixed(3)} square degrees at zoom 6`
      );
    }
    expect(() => {
      const params = validParams();
      params.set("limit", "201");
      return parseMapQuery(params);
    }).toThrow(/limit/);
    expect(() => {
      const params = validParams();
      params.set("q", "a");
      return parseMapQuery(params);
    }).toThrow(/2 characters/);
  });

  it("rejects oversized raw inputs before normalization or list expansion", () => {
    const query = validParams();
    query.set("q", "%".repeat(257));
    expect(() => parseMapQuery(query)).toThrow(/q input/);

    const categories = validParams();
    categories.set("categories", "x".repeat(1025));
    expect(() => parseMapQuery(categories)).toThrow(/categories is too long/);

    const detailedViewport = new URLSearchParams({
      bbox: "13,42,20,47",
      zoom: "12",
    });
    expect(() => parseMapQuery(detailedViewport)).toThrow(/bbox area/);
  });

  it("emits a canonical cache-friendly query string", () => {
    const query = parseMapQuery(
      new URLSearchParams({
        bbox: "13,42,16,47",
        zoom: "7",
        categories: "soup_kitchen,caritas",
      })
    );
    const output = buildMapQueryString(query);
    expect(output).toContain("categories=caritas%2Csoup_kitchen");
    expect(output).toContain("limit=150");
    expect(output).toBe(buildMapQueryString(query));
  });

  it("normalizes wildcard characters before an indexed search", () => {
    expect(normalizeMapSearch("  DOM%__ZA   DJECU ")).toBe("dom za djecu");
  });
});

describe("hidden-location projection", () => {
  it("is stable, coarse and distinct from the exact coordinate", () => {
    const exact = { latitude: 45.8131, longitude: 15.9775 };
    const first = projectHiddenLocation(
      "50f75f62-3d48-40a0-86d9-a2d59fb72a65",
      exact.latitude,
      exact.longitude
    );
    const repeated = projectHiddenLocation(
      "50f75f62-3d48-40a0-86d9-a2d59fb72a65",
      exact.latitude,
      exact.longitude
    );

    expect(first).toEqual(repeated);
    expect(first).not.toEqual(exact);
    expect(Math.abs(first.latitude - exact.latitude)).toBeLessThan(0.05);
    expect(Math.abs(first.longitude - exact.longitude)).toBeLessThan(0.05);
  });
});

describe("location payload budget", () => {
  it("keeps the maximum feature response below 150 KiB", () => {
    const response: PublicMapResponse = {
      version: 1,
      features: Array.from({ length: MAP_FEATURE_LIMIT }, (_, index) => ({
        kind: "institution" as const,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `Representative Croatian institution ${index}`,
        category: "social_welfare" as const,
        city: "Zagreb",
        address: `Public address ${index}`,
        approximateArea: null,
        latitude: 45.8 + index / 100_000,
        longitude: 15.9 + index / 100_000,
        acceptsDonations: ["food" as const, "clothes" as const],
        isVerified: index % 3 === 0,
        isLocationHidden: false,
        trustStatus: "registry" as const,
        hasUrgentNeed: index % 10 === 0,
      })),
      meta: {
        returned: MAP_FEATURE_LIMIT,
        totalMatches: 10_000,
        totalFeatures: 10_000,
        truncated: true,
        mode: "institutions",
        limit: MAP_FEATURE_LIMIT,
      },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(response)).byteLength;

    expect(bytes).toBeLessThanOrEqual(150 * 1024);
    expect(MAP_LIST_RENDER_LIMIT).toBeLessThan(MAP_FEATURE_LIMIT);
  });
});
