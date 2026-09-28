import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, rpc } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));

import { PATCH } from "./route";

const USER_ID = "33333333-3333-4333-8333-333333333333";

function request(body: unknown, site = "same-origin") {
  return new NextRequest("https://dajsrce.hr/api/me/email-notifications", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "https://dajsrce.hr",
      "sec-fetch-site": site,
      "x-forwarded-for": `10.3.0.${Math.floor(Math.random() * 250)}`,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  getUser.mockReset();
  rpc.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  rpc.mockImplementation(async (_name: string, args: { p_enabled: boolean }) => ({ data: args.p_enabled, error: null }));
});

describe("PATCH /api/me/email-notifications", () => {
  it("turns e-mail off for the signed-in account only", async () => {
    const response = await PATCH(request({ enabled: false, p_actor_id: "someone-else" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false });
    expect(rpc).toHaveBeenCalledWith("set_email_notifications", { p_actor_id: USER_ID, p_enabled: false });
  });

  it("needs a session, a boolean and the site's own origin", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await PATCH(request({ enabled: true }))).status).toBe(401);
    expect((await PATCH(request({ enabled: "yes" }))).status).toBe(400);
    expect((await PATCH(request("{"))).status).toBe(400);
    expect((await PATCH(request({ enabled: true }, "cross-site"))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a failed save instead of pretending", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "profile not found" } });
    expect((await PATCH(request({ enabled: true }))).status).toBe(500);
  });
});
