import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { exchangeCodeForSession, verifyOtp, getUser, from, maybeSingle } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  return {
    exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn(), getUser: vi.fn(), maybeSingle,
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })),
  };
});
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { exchangeCodeForSession, verifyOtp, getUser }, from,
  }),
}));
import { GET } from "./route";

async function destination(query: string) {
  const response = await GET(new NextRequest(`https://dajsrce.test/auth/callback${query}`));
  return response.headers.get("location");
}

beforeEach(() => {
  vi.clearAllMocks();
  exchangeCodeForSession.mockResolvedValue({ data: { redirectType: null }, error: null });
  verifyOtp.mockResolvedValue({ error: null });
  getUser.mockResolvedValue({ data: { user: {
    id: "ngo-1", app_metadata: { provider: "email" }, user_metadata: { role: "ngo" },
  } } });
  maybeSingle.mockResolvedValue({ data: { role: "ngo", institution_id: null } });
});

describe("auth callback recovery", () => {
  it("prioritizes password reset over pending NGO onboarding", async () => {
    expect(await destination("?code=code&next=/auth/reset-password"))
      .toBe("https://dajsrce.test/auth/reset-password");
    expect(from).not.toHaveBeenCalled();
  });
  it("recognizes recovery from the verified code exchange even without next", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { redirectType: "recovery" }, error: null });
    expect(await destination("?code=code")).toBe("https://dajsrce.test/auth/reset-password");
  });
  it("passes the flow ID to the server-side PKCE exchange", async () => {
    await destination("?code=code&sb_flow_id=flow-id&next=/auth/reset-password");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("code", { flowId: "flow-id" });
  });
  it("verifies portable token-hash links without a browser verifier", async () => {
    expect(await destination("?token_hash=hash&type=recovery"))
      .toBe("https://dajsrce.test/auth/reset-password");
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash", type: "recovery" });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("lets the browser handle recovery fragments instead of sending it to login", async () => {
    expect(await destination("?next=/auth/reset-password"))
      .toBe("https://dajsrce.test/auth/reset-password");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("shows invalid recovery for expired or reused codes and tokens", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: { code: "otp_expired" } });
    verifyOtp.mockResolvedValue({ error: { code: "otp_expired" } });
    for (const query of [
      "?code=expired&next=/auth/reset-password",
      "?token_hash=expired&type=recovery",
      "?error=access_denied&next=/auth/reset-password",
    ]) {
      expect(await destination(query)).toBe("https://dajsrce.test/auth/reset-password?error=invalid_recovery");
    }
  });
  it("preserves NGO onboarding for ordinary sign-in", async () => {
    expect(await destination("?code=code")).toBe("https://dajsrce.test/auth/setup");
  });
  it("keeps an external next URL from becoming an open redirect", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await destination("?code=code&next=https://evil.test"))
      .toBe("https://dajsrce.test/dashboard");
  });
});
