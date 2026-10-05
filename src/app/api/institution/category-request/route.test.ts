import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, rpc } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@/lib/observability", () => ({
  getRequestId: () => "request-id",
  logError: vi.fn(),
}));
import { POST } from "./route";

const ACTOR = "22222222-2222-4222-8222-222222222222";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/institution/category-request", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );
}

describe("POST /api/institution/category-request", () => {
  beforeEach(() => {
    getUser.mockReset();
    rpc.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: ACTOR } } });
  });

  it("requires a signed-in user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await post({ label: "Dnevni boravak" })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a missing, short or long type without calling the RPC", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ label: "x" })).status).toBe(400);
    expect((await post({ label: "x".repeat(81) })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the normalised type with the actor taken from the session", async () => {
    const request = { id: "r1", label: "Dnevni boravak", status: "pending" };
    rpc.mockResolvedValue({ data: request, error: null });
    const res = await post({ label: "  Dnevni   boravak ", institution_id: "someone-else" });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("request_institution_category_label", {
      p_actor_id: ACTOR,
      p_label: "Dnevni boravak",
    });
    expect(await res.json()).toEqual({ request });
  });

  it("maps the daily cap and ownership errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "too many" } });
    expect((await post({ label: "Dnevni boravak" })).status).toBe(429);
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not linked" } });
    expect((await post({ label: "Dnevni boravak" })).status).toBe(403);
  });
});
