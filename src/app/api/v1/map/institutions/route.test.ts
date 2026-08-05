import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase/public", () => ({
  createPublicSupabaseClient: () => ({ rpc }),
}));

import { GET } from "@/app/api/v1/map/institutions/route";

const url =
  "http://localhost/api/v1/map/institutions?bbox=13,42,20,47&zoom=7&limit=150";

describe("GET /api/v1/map/institutions", () => {
  beforeEach(() => rpc.mockReset());

  it("returns a narrow, cacheable and explicitly bounded contract", async () => {
    rpc.mockResolvedValue({
      error: null,
      data: [
        {
          feature_kind: "cluster",
          feature_id: "cluster:7:31:91",
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
    expect(response.headers.get("etag")).toMatch(/^".+"$/);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(payload).toEqual({
      version: 2,
      features: [
        {
          kind: "cluster",
          id: "cluster:7:31:91",
          latitude: 45.5,
          longitude: 15.5,
          count: 1073,
          bounds: [13.5, 42.5, 19.5, 46.5],
          hasUrgentNeed: true,
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

  it("honours If-None-Match with a stable semantic ETag", async () => {
    rpc.mockResolvedValue({ error: null, data: [] });
    const first = await GET(new NextRequest(url));
    const etag = first.headers.get("etag")!;
    const second = await GET(
      new NextRequest(url, { headers: { "If-None-Match": etag } })
    );

    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
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
});
