import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, userTokenForClaims, anonDataApiToken } = vi.hoisted(() => ({
  getUser: vi.fn(),
  userTokenForClaims: vi.fn(),
  anonDataApiToken: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/data-api/session", () => ({ userTokenForClaims }));
vi.mock("@/lib/data-api/token", () => ({ anonDataApiToken }));

import { GET } from "@/app/api/auth/data-token/route";

const USER = {
  id: "11111111-2222-4333-8444-555555555555",
  email: "ana@example.hr",
  user_metadata: { name: "Ana" },
};

let address = 0;

function request(headers: Record<string, string> = {}) {
  // A fresh client address per request keeps the shared limiter out of the way.
  address += 1;
  return new NextRequest("http://localhost/api/auth/data-token", {
    headers: { "x-forwarded-for": `192.0.2.${address}`, ...headers },
  });
}

beforeEach(() => {
  getUser.mockReset();
  userTokenForClaims.mockReset();
  anonDataApiToken.mockReset();
  anonDataApiToken.mockResolvedValue("anon-token");
});

describe("GET /api/auth/data-token", () => {
  it("issues no anonymous token to a visitor without a session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).not.toHaveProperty("token");
    expect(anonDataApiToken).not.toHaveBeenCalled();
    expect(userTokenForClaims).not.toHaveBeenCalled();
  });

  it("refuses an anonymous Supabase user the same way", async () => {
    getUser.mockResolvedValue({ data: { user: { ...USER, is_anonymous: true } } });
    expect((await GET(request())).status).toBe(401);
    expect(userTokenForClaims).not.toHaveBeenCalled();
  });

  it("mints the signed-in user's own token from getUser()", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });
    userTokenForClaims.mockResolvedValue({ token: "user-token", exp: 1_900_000_000 });
    const response = await GET(request({ "sec-fetch-site": "same-origin" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ token: "user-token", exp: 1_900_000_000 });
    expect(userTokenForClaims).toHaveBeenCalledWith({
      id: USER.id,
      email: USER.email,
      userMetadata: USER.user_metadata,
    });
  });

  it("refuses a cross-site request before looking at the session", async () => {
    const response = await GET(request({ "sec-fetch-site": "cross-site" }));
    expect(response.status).toBe(403);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("fails closed when a token cannot be minted", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });
    userTokenForClaims.mockRejectedValue(new Error("no key"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("token");
  });
});
