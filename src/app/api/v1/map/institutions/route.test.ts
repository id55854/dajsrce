import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
let clientFactory: () => { rpc: typeof rpc; from?: unknown } = () => ({ rpc });

// The real module is spread back in so `PublicSupabaseConfigError` stays the
// same class the route compares against; only the client itself is faked.
vi.mock("@/lib/supabase/public", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/public")>()),
  createPublicSupabaseClient: () => clientFactory(),
}));

import { PublicSupabaseConfigError } from "@/lib/supabase/public";

import { GET } from "@/app/api/v1/map/institutions/route";

const url =
  "http://localhost/api/v1/map/institutions?bbox=13,42,20,47&zoom=7&limit=150";

/** One `map_association_registry_v*` institution row, exact unless overridden. */
function institutionRow(overrides: Record<string, unknown>) {
  return {
    feature_kind: "institution",
    feature_id: "registry:99001",
    institution_id: null,
    registry_id: "99001",
    entity_type: "registry",
    name: "Udruga za podršku žrtvama",
    category: "domestic_violence",
    city: "Pula",
    address: "Koparska 58, Pula",
    approximate_area: null,
    location_precision: "exact",
    latitude: 44.869137,
    longitude: 13.848412,
    accepts_donations: [],
    is_verified: false,
    is_location_hidden: false,
    source: "registry",
    has_urgent_need: false,
    member_count: 1,
    min_lng: 13.848412,
    min_lat: 44.869137,
    max_lng: 13.848412,
    max_lat: 44.869137,
    total_matches: 1,
    total_features: 1,
    ...overrides,
  };
}

/** A supabase-js query builder stand-in for the bounded fallback. */
function fallbackQuery(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "gte", "lte", "in", "overlaps", "ilike", "or", "order", "eq"]) {
    builder[method] = () => builder;
  }
  builder.limit = () => Promise.resolve({ data: rows, error: null, count: rows.length });
  return builder;
}

describe("GET /api/v1/map/institutions", () => {
  beforeEach(() => {
    rpc.mockReset();
    clientFactory = () => ({ rpc });
  });

  it("returns a narrow, cacheable and explicitly bounded contract", async () => {
    rpc.mockResolvedValue({
      error: null,
      data: [
        {
          feature_kind: "cluster",
          feature_id: "place:county:Zagrebačka",
          place_kind: "county",
          place_name: "Zagrebačka",
          institution_id: null,
          registry_id: null,
          entity_type: null,
          name: null,
          category: null,
          city: null,
          address: null,
          approximate_area: null,
          location_precision: null,
          latitude: 45.5,
          longitude: 15.5,
          accepts_donations: [],
          is_verified: false,
          is_location_hidden: false,
          source: null,
          has_urgent_need: true,
          member_count: 1073,
          min_lng: 13.5,
          min_lat: 42.5,
          max_lng: 19.5,
          max_lat: 46.5,
          total_matches: 1073,
          total_features: 1,
        },
      ],
    });

    const response = await GET(new NextRequest(url));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(response.headers.get("etag")).toMatch(/^W\/".+"$/);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(payload).toEqual({
      version: 2,
      features: [
        {
          kind: "cluster",
          id: "place:county:Zagrebačka",
          latitude: 45.5,
          longitude: 15.5,
          count: 1073,
          bounds: [13.5, 42.5, 19.5, 46.5],
          hasUrgentNeed: true,
          placeKind: "county",
          placeName: "Zagrebačka",
        },
      ],
      meta: {
        returned: 1,
        totalMatches: 1073,
        totalFeatures: 1,
        truncated: false,
        mode: "clusters",
        limit: 150,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("phone");
    expect(JSON.stringify(payload)).not.toContain("email");
    expect(JSON.stringify(payload)).not.toContain("description");
    expect(rpc).toHaveBeenCalledWith("map_association_registry_v2", expect.any(Object));
  });

  it("filters by donation type under whichever argument the deployed function has", async () => {
    const empty = { error: null, data: [] };

    rpc.mockResolvedValue(empty);
    await GET(new NextRequest(`${url}&donationTypes=food`));
    // One type keeps the original scalar argument, so the filter survives a
    // schema that predates the multi-select migration.
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_donation_type: "food" });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_donation_types");

    rpc.mockReset();
    rpc.mockResolvedValue(empty);
    await GET(new NextRequest(`${url}&donationTypes=food,hygiene`));
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_donation_types: ["food", "hygiene"] });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_donation_type");

    rpc.mockReset();
    rpc.mockResolvedValue(empty);
    await GET(new NextRequest(url));
    // Nothing selected sends neither argument rather than an explicit null.
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_donation_type");
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_donation_types");
  });

  it("falls back to the complete v1 map during a rolling database deployment", async () => {
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST202", message: "map_association_registry_v2 was not found" },
      })
      .mockResolvedValueOnce({ data: [], error: null });

    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(1, "map_association_registry_v2", expect.any(Object));
    expect(rpc).toHaveBeenNthCalledWith(2, "map_association_registry_v1", expect.any(Object));
  });

  it("renders a cluster from a function that predates the place columns", async () => {
    // A rolling deployment can put this route ahead of the migration. Without
    // the fallback the marker would be captioned "undefined" rather than
    // degrading to the count-only cluster the old grid produced.
    rpc.mockResolvedValue({
      error: null,
      data: [
        {
          feature_kind: "cluster",
          feature_id: "registry-cluster:7:3:4",
          institution_id: null,
          registry_id: null,
          entity_type: null,
          name: null,
          category: null,
          city: null,
          address: null,
          approximate_area: null,
          location_precision: null,
          latitude: 45.5,
          longitude: 15.5,
          accepts_donations: [],
          is_verified: false,
          is_location_hidden: false,
          source: null,
          has_urgent_need: false,
          member_count: 12,
          min_lng: 15,
          min_lat: 45,
          max_lng: 16,
          max_lat: 46,
          total_matches: 12,
          total_features: 1,
        },
      ],
    });

    const payload = await (await GET(new NextRequest(url))).json();

    expect(payload.features[0]).toMatchObject({
      kind: "cluster",
      placeKind: "grid",
      placeName: null,
    });
  });

  it("keeps a grid cluster unnamed even if a place name leaks in", async () => {
    rpc.mockResolvedValue({
      error: null,
      data: [
        {
          feature_kind: "cluster",
          feature_id: "registry-cluster:7:3:4",
          institution_id: null,
          registry_id: null,
          entity_type: null,
          name: null,
          category: null,
          city: null,
          address: null,
          approximate_area: null,
          location_precision: null,
          latitude: 45.5,
          longitude: 15.5,
          accepts_donations: [],
          is_verified: false,
          is_location_hidden: false,
          source: null,
          has_urgent_need: false,
          member_count: 12,
          min_lng: 15,
          min_lat: 45,
          max_lng: 16,
          max_lat: 46,
          total_matches: 12,
          total_features: 1,
          place_kind: "grid",
          place_name: "Nonsense",
        },
      ],
    });

    const payload = await (await GET(new NextRequest(url))).json();

    expect(payload.features[0].placeName).toBeNull();
  });

  it("honours If-None-Match with a stable semantic ETag", async () => {
    rpc.mockResolvedValue({ error: null, data: [] });
    const first = await GET(new NextRequest(url));
    const etag = first.headers.get("etag")!;
    const second = await GET(
      new NextRequest(url, { headers: { "If-None-Match": etag } })
    );

    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    // The validator is derived from the query and cache window, so the
    // revalidation never reached the database.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("shares one ETag across equivalent viewports and filters", async () => {
    rpc.mockResolvedValue({ error: null, data: [] });
    const spaced = await GET(
      new NextRequest(
        "http://localhost/api/v1/map/institutions?bbox=13.00001,42.00002,20.00003,47.00004&zoom=7&limit=150&categories=soup_kitchen,caritas"
      )
    );
    const reordered = await GET(
      new NextRequest(
        "http://localhost/api/v1/map/institutions?categories=caritas,soup_kitchen&zoom=7&bbox=13,42,20,47&limit=150"
      )
    );

    expect(spaced.headers.get("etag")).toBe(reordered.headers.get("etag"));
  });

  it("rejects an invalid query before touching the database", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/v1/map/institutions?bbox=-180,-90,180,90&zoom=2"
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Invalid map query");
    expect(payload.issues.length).toBeGreaterThan(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("caps a drifting RPC response at the requested public limit", async () => {
    rpc.mockResolvedValue({
      error: null,
      data: Array.from({ length: 180 }, (_, index) => ({
        feature_kind: "institution",
        feature_id: `feature-${index}`,
        institution_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        registry_id: `udr-${index}`,
        entity_type: "institution",
        name: `Institution ${index}`,
        category: "social_welfare",
        city: "Zagreb",
        address: `Address ${index}`,
        approximate_area: null,
        location_precision: "exact",
        latitude: 45.8,
        longitude: 15.9,
        accepts_donations: [],
        is_verified: false,
        is_location_hidden: false,
        source: "registry",
        has_urgent_need: false,
        member_count: 1,
        min_lng: 15.9,
        min_lat: 45.8,
        max_lng: 15.9,
        max_lat: 45.8,
        total_matches: 180,
        total_features: 180,
      })),
    });

    const response = await GET(new NextRequest(url));
    const payload = await response.json();
    expect(payload.features).toHaveLength(150);
    expect(payload.meta.truncated).toBe(true);
  });

  it("returns registry-only organisations with an official-detail target", async () => {
    rpc.mockResolvedValue({
      error: null,
      data: [{
        feature_kind: "institution",
        feature_id: "registry:12345",
        institution_id: null,
        registry_id: "12345",
        entity_type: "registry",
        name: "Example association",
        category: "association",
        city: "Split",
        address: null,
        approximate_area: "Split, Splitsko-dalmatinska županija",
        location_precision: "city",
        latitude: 43.51,
        longitude: 16.44,
        accepts_donations: [],
        is_verified: false,
        is_location_hidden: false,
        source: "registry",
        has_urgent_need: false,
        member_count: 1,
        min_lng: 16.44,
        min_lat: 43.51,
        max_lng: 16.44,
        max_lat: 43.51,
        total_matches: 1,
        total_features: 1,
      }],
    });

    const response = await GET(new NextRequest(url));
    const payload = await response.json();
    expect(payload.features[0]).toMatchObject({
      id: "registry:12345",
      entityType: "registry",
      registryId: "12345",
      locationPrecision: "city",
    });
  });
  it("never pins a protected-category register row at its registered seat", async () => {
    // The register publishes the seat, but a pin under "violence prevention"
    // reads as "a shelter is here". The row must look exactly like a hidden
    // location: coarse point, no street address.
    rpc.mockResolvedValue({ error: null, data: [institutionRow({})] });

    const response = await GET(new NextRequest(`${url}&categories=domestic_violence`));
    const payload = await response.json();
    const [feature] = payload.features;

    expect(response.status).toBe(200);
    expect(feature).toMatchObject({
      id: "registry:99001",
      category: "domestic_violence",
      address: null,
      isLocationHidden: true,
      locationPrecision: "hidden",
    });
    expect(feature.latitude).not.toBe(44.869137);
    expect(feature.longitude).not.toBe(13.848412);
    // Coarse, not random: the same few-kilometre cell every time.
    expect(Math.abs(feature.latitude - 44.869137)).toBeLessThan(0.05);
    expect(Math.abs(feature.longitude - 13.848412)).toBeLessThan(0.05);
    const body = JSON.stringify(payload);
    expect(body).not.toContain("Koparska");
    expect(body).not.toContain("44.869137");
    expect(body).not.toContain("13.848412");

    const again = await (await GET(new NextRequest(`${url}&categories=domestic_violence`))).json();
    expect(again.features[0].latitude).toBe(feature.latitude);
    expect(again.features[0].longitude).toBe(feature.longitude);
  });

  it("still coarsens a protected register row that arrives flagged hidden at an exact point", async () => {
    // A directory point projected before its institution was hidden is the
    // exact seat even though the row now says hidden (2026-09-26).
    rpc.mockResolvedValue({
      error: null,
      data: [institutionRow({ is_location_hidden: true, location_precision: "exact" })],
    });

    const payload = await (await GET(new NextRequest(`${url}&categories=domestic_violence`))).json();
    const [feature] = payload.features;

    expect(feature).toMatchObject({ address: null, isLocationHidden: true, locationPrecision: "hidden" });
    const body = JSON.stringify(payload);
    expect(body).not.toContain("44.869137");
    expect(body).not.toContain("13.848412");
    expect(body).not.toContain("Koparska");
  });

  it("protects an account holder's row in that category too, but not a curated one", async () => {
    rpc.mockResolvedValue({
      error: null,
      data: [
        institutionRow({
          feature_id: "8d6f5e8a-5f0c-4b8f-9d53-3a1c2b7e9f10",
          institution_id: "8d6f5e8a-5f0c-4b8f-9d53-3a1c2b7e9f10",
          entity_type: "institution",
          source: "registry_claim",
        }),
        institutionRow({
          feature_id: "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
          institution_id: "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
          registry_id: null,
          entity_type: "institution",
          name: "Reviewed counselling centre",
          address: "Ilica 1, Zagreb",
          latitude: 45.8132,
          longitude: 15.9771,
          is_verified: true,
          source: "curated",
        }),
      ],
    });

    const payload = await (await GET(new NextRequest(url))).json();
    const [claimed, curated] = payload.features;

    expect(claimed).toMatchObject({ address: null, isLocationHidden: true, locationPrecision: "hidden" });
    expect(claimed.latitude).not.toBe(44.869137);
    // A person reviewed the curated row and its own hidden flag stands.
    expect(curated).toMatchObject({
      address: "Ilica 1, Zagreb",
      latitude: 45.8132,
      longitude: 15.9771,
      isLocationHidden: false,
      locationPrecision: "exact",
    });
  });

  it("applies the same protection on the bounded fallback", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "map_association_registry_v2 was not found" },
    });
    clientFactory = () => ({
      rpc,
      from: () =>
        fallbackQuery([
          {
            id: "8d6f5e8a-5f0c-4b8f-9d53-3a1c2b7e9f10",
            name: "Udruga za podršku žrtvama",
            category: "domestic_violence",
            city: "Pula",
            approximate_area: null,
            public_lat: 44.869137,
            public_lng: 13.848412,
            accepts_donations: [],
            is_verified: false,
            is_location_hidden: false,
            source: "registry",
          },
        ]),
    });

    const response = await GET(new NextRequest(url));
    const payload = await response.json();

    expect(response.headers.get("x-map-query-strategy")).toBe("bounded-fallback");
    expect(payload.features[0]).toMatchObject({ address: null, isLocationHidden: true, locationPrecision: "hidden" });
    expect(JSON.stringify(payload)).not.toContain("44.869137");
    expect(JSON.stringify(payload)).not.toContain("13.848412");
  });

  it("retries once when the statement timeout cancels a cold query", async () => {
    // Supabase caps `anon` statements at three seconds, and the first
    // country-wide query against an idle project spends that budget warming
    // indexes. Production never sees it because the CDN serves the warm copy;
    // a dev server has no CDN, so without the retry every boot opens empty.
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "57014", message: "canceling statement due to statement timeout" },
      })
      .mockResolvedValueOnce({ data: [], error: null });

    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(2, "map_association_registry_v2", expect.any(Object));
  });

  it("reports a persistent timeout rather than retrying forever", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });

    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(503);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("names the missing variables when the environment has no credentials", async () => {
    clientFactory = () => {
      throw new PublicSupabaseConfigError(["NEXT_PUBLIC_SUPABASE_URL"]);
    };

    const response = await GET(new NextRequest(url));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.code).toBe("not_configured");
    expect(payload.missing).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("withholds the configuration detail from production responses", async () => {
    clientFactory = () => {
      throw new PublicSupabaseConfigError(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    };
    vi.stubEnv("NODE_ENV", "production");

    try {
      const payload = await (await GET(new NextRequest(url))).json();
      expect(payload.code).toBeUndefined();
      expect(payload.missing).toBeUndefined();
      expect(payload.error).toBe("Institution locations are temporarily unavailable");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
