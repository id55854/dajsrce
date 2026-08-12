import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` factories are hoisted above the module scope, so the doubles have
// to be hoisted with them.
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));

import { GET, POST } from "@/app/api/offers/route";

const AUTHOR = { id: "11111111-2222-4333-8444-555555555555" };

function anonymous() {
  getUser.mockResolvedValue({ data: { user: null } });
}

function signedIn(id = AUTHOR.id) {
  getUser.mockResolvedValue({ data: { user: { id } } });
}

function post(body: unknown) {
  return new NextRequest("http://localhost/api/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_OFFER = {
  title: "Perilica rublja",
  description: "Ispravna.",
  donation_type: "furniture",
  quantity: 1,
  city: "Split",
};

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/offers", () => {
  it("refuses an anonymous read outright and never touches the database", async () => {
    anonymous();
    const response = await GET(new NextRequest("http://localhost/api/offers?scope=open"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an anonymous read of the author and organisation scopes too", async () => {
    for (const scope of ["mine", "inbox"]) {
      anonymous();
      const response = await GET(
        new NextRequest(`http://localhost/api/offers?scope=${scope}`)
      );
      expect(response.status).toBe(401);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an unbounded page before authenticating", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/offers?limit=100000")
    );
    expect(response.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns an unverified organisation into a 403 rather than a list", async () => {
    signedIn();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "organisation is not verified" },
    });
    const response = await GET(new NextRequest("http://localhost/api/offers?scope=open"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Offers could not be listed" });
  });

  it("browses through the bounded RPC and publishes no author identity", async () => {
    signedIn();
    rpc.mockResolvedValue({
      data: {
        items: [
          {
            id: "0f2b9d3c-6b4a-4f57-9a8a-1f2c3d4e5f60",
            title: "20 kg brašna",
            description: "Neotvoreno.",
            donation_type: "food",
            quantity: 20,
            unit: "kg",
            city: "Osijek",
            coarse_lat: 45.535,
            coarse_lng: 18.705,
            available_until: null,
            status: "open",
            created_at: "2026-08-12T09:00:00Z",
            claimed_by_us: false,
            // A stray column from a future RPC change must not be forwarded.
            user_id: "secret-author",
            lat: 45.554_331,
            lng: 18.695_812,
            email: "ana@example.com",
          },
        ],
        meta: { total: 1, limit: 30, offset: 0 },
      },
      error: null,
    });

    const response = await GET(
      new NextRequest("http://localhost/api/offers?scope=open&donationType=food&city=Osijek")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("list_open_donor_offers", {
      p_actor_id: AUTHOR.id,
      p_donation_type: "food",
      p_city: "Osijek",
      p_query: null,
      p_limit: 30,
      p_offset: 0,
    });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].coarse_lat).toBe(45.535);
    for (const field of ["user_id", "lat", "lng", "email"]) {
      expect(payload.items[0]).not.toHaveProperty(field);
    }
  });

  it("routes each scope to its own RPC", async () => {
    signedIn();
    rpc.mockResolvedValue({ data: { items: [], meta: {} }, error: null });

    await GET(new NextRequest("http://localhost/api/offers?scope=mine"));
    expect(rpc).toHaveBeenLastCalledWith("list_own_donor_offers", {
      p_actor_id: AUTHOR.id,
      p_limit: 30,
      p_offset: 0,
    });

    await GET(new NextRequest("http://localhost/api/offers?scope=inbox"));
    expect(rpc).toHaveBeenLastCalledWith("list_institution_offer_claims", {
      p_actor_id: AUTHOR.id,
      p_limit: 30,
      p_offset: 0,
    });
  });
});

describe("POST /api/offers", () => {
  it("requires authentication", async () => {
    anonymous();
    const response = await POST(post(VALID_OFFER));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("validates before authenticating", async () => {
    const response = await POST(post({ ...VALID_OFFER, title: "ab" }));
    expect(response.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("hands the coordinate to the RPC that coarsens it and returns no exact point", async () => {
    signedIn();
    rpc.mockResolvedValue({
      data: {
        id: "0f2b9d3c-6b4a-4f57-9a8a-1f2c3d4e5f60",
        title: "Perilica rublja",
        description: "Ispravna.",
        donation_type: "furniture",
        quantity: 1,
        unit: null,
        city: "Split",
        coarse_lat: 43.525,
        coarse_lng: 16.425,
        available_until: null,
        status: "open",
        claimed_institution_id: null,
        created_at: "2026-08-12T09:00:00Z",
        updated_at: "2026-08-12T09:00:00Z",
      },
      error: null,
    });

    const response = await POST(
      post({ ...VALID_OFFER, latitude: 43.508_132, longitude: 16.440_193 })
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith(
      "create_donor_offer_transaction",
      expect.objectContaining({
        p_actor_id: AUTHOR.id,
        p_city: "Split",
        p_latitude: 43.508_132,
        p_longitude: 16.440_193,
      })
    );
    // The stored and returned point is the coarse one, never the submission.
    expect(payload.offer.coarse_lat).toBe(43.525);
    expect(payload.offer).not.toHaveProperty("lat");
    expect(payload.offer).not.toHaveProperty("user_id");
  });

  it("maps a transactional refusal onto a stable status", async () => {
    signedIn();
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "too many" } });
    const response = await POST(post(VALID_OFFER));
    expect(response.status).toBe(409);
  });
});
