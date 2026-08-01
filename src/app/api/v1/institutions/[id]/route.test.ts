import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase/public", () => ({
  createPublicSupabaseClient: () => ({ rpc }),
}));

import { GET } from "@/app/api/v1/institutions/[id]/route";

const id = "50f75f62-3d48-40a0-86d9-a2d59fb72a65";

describe("GET /api/v1/institutions/:id", () => {
  beforeEach(() => rpc.mockReset());

  it("returns the public projection for a hidden institution", async () => {
    rpc.mockResolvedValue({
      error: null,
      data: [
        {
          id,
          name: "Safe support centre",
          category: "domestic_violence",
          description: "Public description",
          address: null,
          city: "Zagreb",
          latitude: 45.821234,
          longitude: 15.981234,
          phone: "+385 1 555 0100",
          email: null,
          website: null,
          working_hours: null,
          drop_off_hours: null,
          accepts_donations: ["hygiene"],
          capacity: null,
          served_population: "Adults",
          photo_url: null,
          is_verified: true,
          is_location_hidden: true,
          approximate_area: "Zagreb area",
          nearest_zet_stop: null,
          zet_lines: null,
          source: "curated",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ],
    });

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/institutions/${id}`),
      { params: Promise.resolve({ id }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(payload.institution).toMatchObject({
      id,
      address: null,
      latitude: 45.821234,
      longitude: 15.981234,
      isLocationHidden: true,
      trustStatus: "contact_verified",
    });
    expect(payload.institution).not.toHaveProperty("lat");
    expect(payload.institution).not.toHaveProperty("lng");
  });

  it("rejects malformed identifiers without a database call", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/institutions/not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid" }) }
    );

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
