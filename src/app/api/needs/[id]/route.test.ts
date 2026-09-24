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
import { DELETE } from "./route";

const NEED_ID = "11111111-1111-4111-8111-111111111111";

function call(id: string) {
  const req = new NextRequest(`http://localhost/api/needs/${id}`, { method: "DELETE" });
  return DELETE(req, { params: Promise.resolve({ id }) });
}

describe("DELETE /api/needs/[id]", () => {
  beforeEach(() => {
    getUser.mockReset();
    rpc.mockReset();
  });

  it("rejects an id that is not a uuid before any database work", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await call(NEED_ID);
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets the transaction decide ownership and maps a refusal to 403", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "actor" } } });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    const res = await call(NEED_ID);
    expect(rpc).toHaveBeenCalledWith("delete_need_transaction", { p_actor_id: "actor", p_need_id: NEED_ID });
    expect(res.status).toBe(403);
  });

  it("returns what the transaction removed", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "actor" } } });
    rpc.mockResolvedValue({ data: { need_id: NEED_ID, pledges_removed: 2 }, error: null });
    const res = await call(NEED_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: { need_id: NEED_ID, pledges_removed: 2 } });
  });
});
