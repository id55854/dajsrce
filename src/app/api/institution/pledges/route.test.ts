import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ claims: vi.fn(), from: vi.fn(), adminFrom: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from: mocks.adminFrom } }));
vi.mock("@/lib/auth/claims", () => ({ getVerifiedClaims: mocks.claims }));
vi.mock("@/lib/observability", () => ({ getRequestId: () => "request-id", logError: vi.fn() }));
import { GET } from "./route";

function chain(result: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "neq", "in", "order", "limit", "maybeSingle"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle.mockResolvedValue(result);
  query.limit.mockResolvedValue(result);
  // The pledges read ends in `order`; the needs read in `limit`.
  query.order.mockImplementation(() => Object.assign(Promise.resolve(result), query));
  query.in.mockImplementation(() => Object.assign(Promise.resolve(result), query));
  return query;
}

describe("GET /api/institution/pledges", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives the organisation its own donors, their notes, and nothing about them elsewhere", async () => {
    mocks.claims.mockResolvedValue({ id: "ngo-user" });
    const profile = chain({ data: { role: "ngo", institution_id: "inst" } });
    const needs = chain({ data: [{ id: "need-1", title: "Jakne" }], error: null });
    const pledges = chain({
      data: [{ id: "p1", user_id: "donor", need_id: "need-1", quantity: 2, amount_eur: null, message: "Donosim u utorak.", created_at: "2026-09-26T10:00:00Z" }],
      error: null,
    });
    mocks.from.mockImplementation((table: string) =>
      table === "profiles" ? profile : table === "needs" ? needs : pledges
    );
    const donors = chain({ data: [{ id: "donor", name: "Ana", email: "ana@example.org" }] });
    mocks.adminFrom.mockReturnValue(donors);

    const res = await GET(new NextRequest("http://localhost/api/institution/pledges"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pledges[0]).toMatchObject({ message: "Donosim u utorak.", donor: { name: "Ana", email: "ana@example.org" } });
    expect(body).not.toHaveProperty("activity");
    expect(pledges.select.mock.calls[0][0]).toMatch(/\bmessage\b/);
    // The service client is used for the donors' names and e-mails only.
    expect(mocks.adminFrom.mock.calls).toEqual([["profiles"]]);
    expect(donors.in).toHaveBeenCalledWith("id", ["donor"]);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("refuses an account that is not a linked NGO", async () => {
    mocks.claims.mockResolvedValue({ id: "someone" });
    mocks.from.mockReturnValue(chain({ data: { role: "individual", institution_id: null } }));
    expect((await GET(new NextRequest("http://localhost/api/institution/pledges"))).status).toBe(403);
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });
});
