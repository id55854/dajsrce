import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  claims: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock("@/lib/auth/claims", () => ({ getVerifiedClaims: mocks.claims }));
vi.mock("@/lib/observability", () => ({
  getRequestId: () => "request-id",
  logError: vi.fn(),
}));
import { GET, POST } from "./route";

const DONOR = "11111111-1111-4111-8111-111111111111";
const NEED = "33333333-3333-4333-8333-333333333333";

type Chain = Record<"select" | "eq" | "order" | "maybeSingle", ReturnType<typeof vi.fn>>;

function chain(result: unknown): Chain {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), maybeSingle: vi.fn() } as Chain;
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockResolvedValue(result);
  query.maybeSingle.mockResolvedValue(result);
  return query;
}

const HANDOVER = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "UDRUGA",
  category: "association",
  address: "Trnje",
  city: "Zagreb",
  is_location_hidden: true,
  phone: "01 234 5678",
  email: "kontakt@udruga.hr",
  website: null,
  working_hours: null,
  drop_off_hours: "utorkom 10–14 h",
};

function pledge(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/pledges", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );
}

describe("POST /api/pledges", () => {
  let profiles: Chain;
  let needs: Chain;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: DONOR } } });
    profiles = chain({ data: { id: DONOR, role: "individual" }, error: null });
    needs = chain({ data: { institution: HANDOVER }, error: null });
    mocks.from.mockImplementation((table: string) => (table === "profiles" ? profiles : needs));
    mocks.rpc.mockResolvedValue({
      data: {
        pledge: { id: "p1", user_id: DONOR, need_id: NEED, quantity: 2, message: null, amount_eur: null, created_at: "2026-09-26T10:00:00Z" },
        match_pledge_id: null,
        need: { id: NEED, quantity_pledged: 2 },
      },
      error: null,
    });
  });

  it("returns the organisation's public handover details with the confirmation", async () => {
    const res = await pledge({ need_id: NEED, quantity: 2 });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pledge.id).toBe("p1");
    expect(body.institution).toEqual(HANDOVER);
    // Explicit public columns only; the street of a hidden location is never selected.
    const columns = needs.select.mock.calls[0][0] as string;
    expect(columns).toContain("address:public_address");
    expect(columns).toContain("drop_off_hours");
    expect(columns).not.toMatch(/\*|[(,\s]address[,)\s]|[(,\s]lat[,)\s]|lng/);
    expect(needs.eq).toHaveBeenCalledWith("id", NEED);
  });

  it("still confirms the pledge when the handover lookup fails", async () => {
    needs.maybeSingle.mockResolvedValue({ data: null, error: { code: "57014" } });
    const res = await pledge({ need_id: NEED });
    expect(res.status).toBe(201);
    expect((await res.json()).institution).toBeNull();
  });

  it("refuses absurd quantities and values before the transaction", async () => {
    expect((await pledge({ need_id: NEED, quantity: 10_001 })).status).toBe(400);
    expect((await pledge({ need_id: NEED, quantity: 2, amount_eur: 100_001 })).status).toBe(400);
    expect((await pledge({ need_id: NEED, quantity: 2, message: "x".repeat(2001) })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await pledge({ need_id: NEED, quantity: 10_000, amount_eur: 100_000 })).status).toBe(201);
  });

  it("refuses an NGO account and a signed-out visitor before the transaction", async () => {
    profiles.maybeSingle.mockResolvedValue({ data: { id: DONOR, role: "ngo" }, error: null });
    expect((await pledge({ need_id: NEED })).status).toBe(403);
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await pledge({ need_id: NEED })).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("GET /api/pledges", () => {
  it("reads the donor's own pledges with explicit handover columns", async () => {
    mocks.claims.mockResolvedValue({ id: DONOR });
    const pledges = chain({ data: [], error: null });
    mocks.from.mockReturnValue(pledges);
    const res = await GET(new NextRequest("http://localhost/api/pledges"));
    expect(res.status).toBe(200);
    const columns = pledges.select.mock.calls[0][0] as string;
    expect(columns).toContain("institution:institutions(id, name, category, address:public_address, city, is_location_hidden, phone, email, website, working_hours, drop_off_hours)");
    expect(pledges.eq).toHaveBeenCalledWith("user_id", DONOR);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
