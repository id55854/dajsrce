import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, rpc } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@/lib/supabase/public", () => ({ createPublicSupabaseClient: () => ({ rpc }) }));
vi.mock("@/lib/observability", () => ({
  getRequestId: () => "request-id",
  logError: vi.fn(),
}));
import { PATCH } from "./route";

const ACTOR = "22222222-2222-4222-8222-222222222222";

function patch(body: unknown) {
  return PATCH(
    new NextRequest("http://localhost/api/institution", {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );
}

describe("PATCH /api/institution", () => {
  beforeEach(() => {
    getUser.mockReset();
    rpc.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: ACTOR } } });
  });

  it("requires a signed-in user before any database work", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await patch({ phone: "01 234 5678" });
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a malformed patch, naming the field, without calling the RPC", async () => {
    const res = await patch({ phone: "call me" });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("phone");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never lets the body rename or recategorise the institution", async () => {
    expect((await patch({ name: "Nova udruga" })).status).toBe(400);
    expect((await patch({ category: "caritas", phone: "01 234 5678" })).status).toBe(400);
    expect((await patch("not json")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the validated patch with the actor taken from the session", async () => {
    const saved = {
      id: "inst",
      name: "UDRUGA",
      description: null,
      phone: "01 234 5678",
      email: null,
      website: "https://udruga.hr",
      working_hours: null,
      drop_off_hours: null,
      accepts_donations: ["food"],
      donation_acceptance_confirmed: true,
      updated_at: "2026-09-26T10:00:00Z",
    };
    rpc.mockResolvedValue({ data: saved, error: null });
    const res = await patch({ phone: " 01 234 5678 ", website: "udruga.hr", accepts_donations: ["food"] });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_own_institution_profile", {
      p_actor_id: ACTOR,
      p_patch: { phone: "01 234 5678", website: "https://udruga.hr", accepts_donations: ["food"] },
    });
    expect(await res.json()).toEqual({ institution: saved });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    ["42501", 403],
    ["P0002", 404],
    ["22023", 400],
    ["XX000", 500],
  ])("maps RPC error %s to %i without echoing the database message", async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "drop_off_hours is too long" } });
    const res = await patch({ drop_off_hours: "pon 9–12" });
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.error).toBe("Profile could not be updated");
    expect(JSON.stringify(body)).not.toContain("too long");
    expect(body.field).toBe(status === 400 ? "drop_off_hours" : undefined);
  });
});
