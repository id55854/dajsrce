import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { exchangeCodeForSession, verifyOtp, getUser, getClaims, from, maybeSingle } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  return {
    exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(),
    maybeSingle,
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })),
  };
});
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { exchangeCodeForSession, verifyOtp, getUser, getClaims }, from,
  }),
}));
import { GET } from "./route";

async function callbackResponse(query: string) {
  return GET(new NextRequest(`https://dajsrce.test/auth/callback${query}`));
}

async function destination(query: string) {
  return (await callbackResponse(query)).headers.get("location");
}

beforeEach(() => {
  vi.clearAllMocks();
  exchangeCodeForSession.mockResolvedValue({ data: { redirectType: null }, error: null });
  verifyOtp.mockResolvedValue({ error: null });
  getUser.mockResolvedValue({ data: { user: {
    id: "ngo-1", app_metadata: { provider: "email" }, user_metadata: { role: "ngo" },
  } } });
  maybeSingle.mockResolvedValue({ data: { role: "ngo", institution_id: null } });
  getClaims.mockResolvedValue({ data: null, error: { message: "no session" } });
});

describe("auth callback recovery", () => {
  it("prevents recovery redirects from being cached or leaking their URL as a referrer", async () => {
    const response = await callbackResponse("?code=code&next=/auth/reset-password");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

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

describe("auth callback sign-up confirmation", () => {
  it("confirms a token-hash link on any device and continues NGO onboarding", async () => {
    expect(await destination("?token_hash=hash&type=email&next=/dashboard"))
      .toBe("https://dajsrce.test/auth/setup");
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash", type: "email" });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("sends a confirmed individual to their own dashboard", async () => {
    getUser.mockResolvedValue({ data: { user: {
      id: "person-1", app_metadata: { provider: "email" }, user_metadata: { role: "individual" },
    } } });
    maybeSingle.mockResolvedValue({ data: { role: "individual", institution_id: null } });
    expect(await destination("?token_hash=hash&type=email&next=/dashboard"))
      .toBe("https://dajsrce.test/dashboard/individual");
  });

  it("accepts the other portable e-mail link types and nothing else", async () => {
    for (const type of ["signup", "invite", "magiclink", "email_change"]) {
      verifyOtp.mockClear();
      await destination(`?token_hash=hash&type=${type}`);
      expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash", type });
    }
    verifyOtp.mockClear();
    expect(await destination("?token_hash=hash&type=phone_change"))
      .toBe("https://dajsrce.test/auth/login?error=auth_failed");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("explains an expired or reused confirmation instead of a failed sign-in", async () => {
    verifyOtp.mockResolvedValue({ error: { code: "otp_expired" } });
    expect(await destination("?token_hash=used&type=email"))
      .toBe("https://dajsrce.test/auth/login?error=link_invalid");
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps an external next URL from becoming an open redirect", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await destination("?token_hash=hash&type=email&next=https://evil.test"))
      .toBe("https://dajsrce.test/dashboard");
  });
});

describe("auth callback two-step sign-in", () => {
  const USER_ID = "11111111-2222-4333-8444-555555555555";
  const VERIFIED_TOTP = { id: "factor-1", factor_type: "totp", status: "verified" };

  /** getUser() as Supabase Auth answers it, with the account's factors. */
  function enrolled(user: Record<string, unknown>, aal: "aal1" | "aal2" = "aal1") {
    getUser.mockResolvedValue({
      data: {
        user: {
          id: USER_ID,
          app_metadata: { provider: "email" },
          ...user,
          factors: [VERIFIED_TOTP],
        },
      },
    });
    getClaims.mockResolvedValue({ data: { claims: { sub: USER_ID, aal } }, error: null });
  }

  it("asks for the code before the role's dashboard, then continues there", async () => {
    enrolled({ user_metadata: { role: "individual" } });
    maybeSingle.mockResolvedValue({ data: { role: "individual", institution_id: null } });
    expect(await destination("?code=code&next=/dashboard"))
      .toBe("https://dajsrce.test/auth/mfa?next=%2Fdashboard%2Findividual");
  });

  it("keeps NGO onboarding after the code", async () => {
    enrolled({ user_metadata: { role: "ngo" } });
    expect(await destination("?token_hash=hash&type=email&next=/dashboard"))
      .toBe("https://dajsrce.test/auth/mfa?next=%2Fauth%2Fsetup");
  });

  it("keeps the page that was asked for", async () => {
    enrolled({ user_metadata: {} });
    maybeSingle.mockResolvedValue({ data: { role: "individual", institution_id: null } });
    expect(await destination("?code=code&next=/doniraj%3Fview%3Dexplore"))
      .toBe("https://dajsrce.test/auth/mfa?next=%2Fdoniraj%3Fview%3Dexplore");
  });

  it("sends an administrator through the code too", async () => {
    enrolled({ user_metadata: {} });
    maybeSingle.mockResolvedValue({ data: { role: "superadmin", institution_id: null } });
    expect(await destination("?code=code"))
      .toBe("https://dajsrce.test/auth/mfa?next=%2Fdashboard%2Fadmin");
  });

  it("puts the code before a new password", async () => {
    enrolled({ user_metadata: {} });
    expect(await destination("?token_hash=hash&type=recovery"))
      .toBe("https://dajsrce.test/auth/mfa?next=%2Fauth%2Freset-password");
    expect(await destination("?code=code&next=/auth/reset-password"))
      .toBe("https://dajsrce.test/auth/mfa?next=%2Fauth%2Freset-password");
    expect(from).not.toHaveBeenCalled();
  });

  it("goes straight on for a session that already used the app", async () => {
    enrolled({ user_metadata: { role: "individual" } }, "aal2");
    maybeSingle.mockResolvedValue({ data: { role: "individual", institution_id: null } });
    expect(await destination("?code=code&next=/dashboard"))
      .toBe("https://dajsrce.test/dashboard/individual");
  });

  it("asks nothing of an account without a verified factor, and reads no claims", async () => {
    getUser.mockResolvedValue({ data: { user: {
      id: USER_ID, app_metadata: { provider: "email" }, user_metadata: {},
      factors: [{ id: "factor-2", factor_type: "totp", status: "unverified" }],
    } } });
    maybeSingle.mockResolvedValue({ data: { role: "individual", institution_id: null } });
    expect(await destination("?code=code&next=/dashboard"))
      .toBe("https://dajsrce.test/dashboard/individual");
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("asks for the code when the session's claims cannot be verified", async () => {
    enrolled({ user_metadata: {} });
    getClaims.mockResolvedValue({ data: null, error: { message: "invalid JWT" } });
    maybeSingle.mockResolvedValue({ data: { role: "individual", institution_id: null } });
    expect(await destination("?code=code&next=/dashboard"))
      .toBe("https://dajsrce.test/auth/mfa?next=%2Fdashboard%2Findividual");
  });
});
