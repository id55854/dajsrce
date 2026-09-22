import { describe, expect, it } from "vitest";
import {
  MAP_BBOX_MAX_AREA,
  MAP_FEATURE_LIMIT,
  MAP_LIST_RENDER_LIMIT,
  MapQueryValidationError,
  buildMapQueryString,
  mapCacheGridStep,
  maxBboxAreaForZoom,
  normalizeBboxForRequest,
  normalizeMapSearch,
  parseMapQuery,
  projectHiddenLocation,
  resolveMapCategories,
  SOCIAL_MAP_CATEGORIES,
  type MapBounds,
  type PublicMapResponse,
} from "@/lib/location-map";

function validParams() {
  return new URLSearchParams({
    bbox: "13,42,20,47",
    zoom: "7",
  });
}

describe("social category shortcut", () => {
  it("covers every category except the catch-all, and fits the RPC cap", () => {
    // `map_association_registry_v*` raises on more than twelve categories, and
    // the shortcut sends all of them at once, so the cap is a real boundary
    // rather than a guideline.
    expect(SOCIAL_MAP_CATEGORIES).toHaveLength(12);
    expect(SOCIAL_MAP_CATEGORIES).not.toContain("association");
    expect(new Set(SOCIAL_MAP_CATEGORIES).size).toBe(SOCIAL_MAP_CATEGORIES.length);
  });
});

describe("map query contract", () => {
  it("normalizes, validates and bounds a public map query", () => {
    const params = validParams();
    params.set("categories", "soup_kitchen,caritas,soup_kitchen");
    params.set("donationType", "food");
    params.set("onlyUrgent", "true");
    params.set("onlyOnboarded", "true");
    params.set("city", "  Velika Gorica  ");
    params.set("q", "  Pučka%__ KUHINJA  ");

    expect(parseMapQuery(params)).toEqual({
      bbox: [13, 42, 20, 47],
      zoom: 7,
      categories: ["soup_kitchen", "caritas"],
      donationTypes: ["food"],
      onlyZagreb: false,
      onlyUrgent: true,
      onlyOnboarded: true,
      // Trimmed but not case-folded: the value is matched against the
      // register's own spelling, which the picker supplies verbatim.
      city: "Velika Gorica",
      query: "pučka kuhinja",
      limit: MAP_FEATURE_LIMIT,
    });
  });

  it("reads several donation types, and still honours a single-type link", () => {
    const many = validParams();
    many.set("donationTypes", "food,hygiene,food");
    expect(parseMapQuery(many).donationTypes).toEqual(["food", "hygiene"]);

    // Links shared before the filter became multi-select carry the singular
    // spelling; it has to keep resolving to the same filter.
    const legacy = validParams();
    legacy.set("donationType", "clothes");
    expect(parseMapQuery(legacy).donationTypes).toEqual(["clothes"]);

    // Both spellings at once merge rather than one winning.
    const both = validParams();
    both.set("donationTypes", "food");
    both.set("donationType", "clothes");
    expect(parseMapQuery(both).donationTypes).toEqual(["food", "clothes"]);

    const none = validParams();
    expect(parseMapQuery(none).donationTypes).toEqual([]);

    const invalid = validParams();
    invalid.set("donationTypes", "food,not_a_donation_type");
    expect(() => parseMapQuery(invalid)).toThrow(/unsupported donationType/);
  });

  it("sends the donation types to the API as one sorted list", () => {
    const query = parseMapQuery(validParams());
    expect(buildMapQueryString({ ...query, donationTypes: ["hygiene", "food"] })).toContain(
      "donationTypes=food%2Chygiene"
    );
    expect(buildMapQueryString(query)).not.toContain("donationTypes");
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

  it("snaps nearby viewports onto one shared request", () => {
    const base = parseMapQuery(new URLSearchParams({ bbox: "15.9,45.7,16.1,45.9", zoom: "12" }));
    const nudged = parseMapQuery(
      new URLSearchParams({ bbox: "15.9004,45.7003,16.1002,45.9001", zoom: "12" })
    );
    expect(buildMapQueryString(nudged)).toBe(buildMapQueryString(base));

    // The snapped box only ever grows, so nothing visible is cut off.
    const [minLng, minLat, maxLng, maxLat] = normalizeBboxForRequest(base.bbox, 12);
    expect(minLng).toBeLessThanOrEqual(15.9);
    expect(minLat).toBeLessThanOrEqual(45.7);
    expect(maxLng).toBeGreaterThanOrEqual(16.1);
    expect(maxLat).toBeGreaterThanOrEqual(45.9);
    // ...and by less than one grid step (a quarter tile) per edge.
    const step = mapCacheGridStep(12);
    expect(15.9 - minLng).toBeLessThan(step);
    expect(maxLng - 16.1).toBeLessThan(step);
  });

  it("keeps a snapped or oversized viewport inside the API's area guard", () => {
    // A 1920 px wide desktop at zoom 7 spans more than the guard allows.
    const wideDesktop: MapBounds = [5.85, 41.3, 26.95, 49.1];
    const fitted = normalizeBboxForRequest(wideDesktop, 7);
    const area = (fitted[2] - fitted[0]) * (fitted[3] - fitted[1]);
    expect(area).toBeLessThanOrEqual(maxBboxAreaForZoom(7));
    // Centre is preserved to within one grid step (the inward re-snap may
    // move each edge by less than a step), so the visitor still sees what
    // they pointed at.
    const step7 = mapCacheGridStep(7);
    expect(Math.abs((fitted[0] + fitted[2]) / 2 - (5.85 + 26.95) / 2)).toBeLessThanOrEqual(step7);
    expect(Math.abs((fitted[1] + fitted[3]) / 2 - (41.3 + 49.1) / 2)).toBeLessThanOrEqual(step7);

    // Whatever the client sends after normalisation must parse on the server.
    const params = new URLSearchParams({
      bbox: fitted.map((value) => value.toFixed(5)).join(","),
      zoom: "7",
    });
    expect(() => parseMapQuery(params)).not.toThrow();

    // The same holds for every zoom level with a box right at the guard.
    for (let zoom = 6; zoom <= 19; zoom += 1) {
      const side = Math.sqrt(maxBboxAreaForZoom(zoom));
      const box: MapBounds = [16 - side / 2, 45 - side / 2, 16 + side / 2, 45 + side / 2];
      const normalized = normalizeBboxForRequest(box, zoom);
      const query = new URLSearchParams({
        bbox: normalized.map((value) => value.toFixed(5)).join(","),
        zoom: String(zoom),
      });
      expect(() => parseMapQuery(query), `zoom ${zoom}`).not.toThrow();
    }
  });

  it("normalizes wildcard characters before an indexed search", () => {
    expect(normalizeMapSearch("  DOM%__ZA   DJECU ")).toBe("dom za djecu");
  });

  it("drops the classified-only default for the On DajSrce filter", () => {
    // An onboarded organisation whose register row was never classified is
    // still `association`; asking for the twelve classified categories hid it.
    expect(
      resolveMapCategories({ categories: [], onlySocial: true, onlyOnboarded: true })
    ).toEqual([]);
    expect(
      resolveMapCategories({ categories: [], onlySocial: true, onlyOnboarded: false })
    ).toEqual(SOCIAL_MAP_CATEGORIES);
    // An explicit choice wins over both defaults.
    expect(
      resolveMapCategories({
        categories: ["soup_kitchen"],
        onlySocial: true,
        onlyOnboarded: true,
      })
    ).toEqual(["soup_kitchen"]);
  });

  it("reduces a typed OIB to its bare digits", () => {
    // The register's search text holds the plain eleven digits, so every
    // shape a person might paste has to arrive as those digits.
    expect(normalizeMapSearch("28238949295")).toBe("28238949295");
    expect(normalizeMapSearch("OIB: 28238949295")).toBe("28238949295");
    expect(normalizeMapSearch("282-3894-9295")).toBe("28238949295");
    expect(normalizeMapSearch(" oib 282 389 49295 ")).toBe("28238949295");
  });

  it("leaves anything that is not a whole OIB as an ordinary search", () => {
    expect(normalizeMapSearch("2823894")).toBe("2823894");
    expect(normalizeMapSearch("282389492950")).toBe("282389492950");
    expect(normalizeMapSearch("Dom 2")).toBe("dom 2");
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
      version: 2,
      features: Array.from({ length: MAP_FEATURE_LIMIT }, (_, index) => ({
        kind: "institution" as const,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        entityType: "institution" as const,
        registryId: `udr-${index}`,
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
        locationPrecision: "exact" as const,
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
