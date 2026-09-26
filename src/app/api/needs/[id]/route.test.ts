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
import { DELETE, PATCH } from "./route";

const NEED_ID = "11111111-1111-4111-8111-111111111111";

function call(id: string) {
  const req = new NextRequest(`http://localhost/api/needs/${id}`, { method: "DELETE" });
  return DELETE(req, { params: Promise.resolve({ id }) });
}

function edit(id: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/needs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

describe("PATCH /api/needs/[id]", () => {
  beforeEach(() => {
    getUser.mockReset();
    rpc.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "actor" } } });
  });

  it("checks the id, the session and the patch before the transaction", async () => {
    expect((await edit("not-a-uuid", { title: "x" })).status).toBe(400);
    expect((await edit(NEED_ID, { donation_type: "money" })).status).toBe(400);
    const invalid = await edit(NEED_ID, { quantity_needed: 0 });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).field).toBe("quantity_needed");
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await edit(NEED_ID, { title: "x" })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets the transaction decide ownership, with the actor from the session", async () => {
    const need = { id: NEED_ID, title: "Jakne", is_fulfilled: true };
    rpc.mockResolvedValue({ data: need, error: null });
    const res = await edit(NEED_ID, { title: " Jakne ", is_fulfilled: true });
    expect(rpc).toHaveBeenCalledWith("update_need_transaction", {
      p_actor_id: "actor",
      p_need_id: NEED_ID,
      p_patch: { title: "Jakne", is_fulfilled: true },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ need });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    ["42501", 403, undefined],
    ["P0002", 404, undefined],
    ["22023", 400, undefined],
    ["23514", 409, "quantity_below_pledged"],
    ["XX000", 500, undefined],
  ])("maps RPC error %s to %i", async (code, status, stableCode) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "quantity_needed below pledged" } });
    const res = await edit(NEED_ID, { quantity_needed: 2 });
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.error).toBe("Need could not be updated");
    expect(body.code).toBe(stableCode);
  });
});

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
