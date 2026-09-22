import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claims: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ from: mocks.from }) }));
vi.mock("@/lib/auth/claims", () => ({ getVerifiedClaims: mocks.claims }));
import { GET } from "./route";

const request = () => new NextRequest("http://localhost/api/institution/calendar");
function query(result: unknown) {
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.order.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result); chain.maybeSingle.mockResolvedValue(result);
  return chain;
}
describe("private institution calendar", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("rejects anonymous requests before querying data", async () => {
    mocks.claims.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([{ role: "individual", institution_id: "other" }, { role: "ngo", institution_id: null }])("rejects accounts without NGO ownership", async (profile) => {
    mocks.claims.mockResolvedValue({ id: "user" });
    mocks.from.mockReturnValue(query({ data: profile }));
    expect((await GET(request())).status).toBe(403);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it("scopes both reads to the verified institution and prevents caching", async () => {
    mocks.claims.mockResolvedValue({ id: "user" });
    const profile = query({ data: { role: "ngo", institution_id: "owned" } });
    const needs = query({ data: [] });
    const events = query({ data: [] });
    mocks.from.mockImplementation((table) => table === "profiles" ? profile : table === "needs" ? needs : events);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(profile.eq).toHaveBeenCalledWith("id", "user");
    for (const q of [needs, events]) {
      expect(q.eq).toHaveBeenCalledWith("institution_id", "owned");
      expect(q.limit).toHaveBeenCalledWith(101);
    }
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ entries: [], truncated: false });
  });
  it("does not present a failed database read as an empty calendar", async () => {
    mocks.claims.mockResolvedValue({ id: "user" });
    mocks.from.mockImplementation((table) => query(table === "profiles" ? { data: { role: "ngo", institution_id: "owned" } } : { error: { code: "failed" } }));
    expect((await GET(request())).status).toBe(500);
  });
});
