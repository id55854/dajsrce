import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, resetPasswordForEmail } = vi.hoisted(() => {
  const resetPasswordForEmail = vi.fn();
  return { resetPasswordForEmail, createClient: vi.fn(() => ({ auth: { resetPasswordForEmail } })) };
});
vi.mock("@supabase/supabase-js", () => ({ createClient }));
import { establishRecoverySession, sendPasswordRecovery } from "./password-recovery";

beforeEach(() => { vi.clearAllMocks(); });

/** A JWT-shaped string carrying only the claims establishRecoverySession reads. */
function fakeAccessToken(amr: { method: string; timestamp: number }[]): string {
  const payload = Buffer.from(JSON.stringify({ amr })).toString("base64url");
  return `header.${payload}.signature`;
}

const RECOVERY_TOKEN = fakeAccessToken([{ method: "recovery", timestamp: Date.now() / 1000 }]);
const PASSWORD_TOKEN = fakeAccessToken([{ method: "password", timestamp: Date.now() / 1000 }]);
const STALE_RECOVERY_TOKEN = fakeAccessToken([
  { method: "recovery", timestamp: Date.now() / 1000 - 61 * 60 },
]);

describe("portable password recovery", () => {
  it("sends an email without tying the link to the requesting browser's PKCE storage", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key");
    try {
      await sendPasswordRecovery("person@example.test", "https://dajsrce.test");
      expect(createClient).toHaveBeenCalledWith("https://test.supabase.co", "test-key", {
        auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false,
          detectSessionInUrl: false, storageKey: "dajsrce-password-recovery-request" },
      });
      expect(resetPasswordForEmail).toHaveBeenCalledWith("person@example.test", {
        redirectTo: "https://dajsrce.test/auth/callback?next=%2Fauth%2Freset-password",
      });
    } finally { vi.unstubAllEnvs(); }
  });

  function setup(accessToken: string | null) {
    const setSession = vi.fn().mockResolvedValue({ error: null });
    const session = accessToken
      ? { access_token: accessToken, user: { id: "owner", email: "owner@example.test" } }
      : null;
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const getUser = vi.fn().mockResolvedValue({ data: { user: session?.user ?? null }, error: null });
    const client = { auth: { setSession, getSession, getUser } } as unknown as SupabaseClient;
    return { client, setSession, getSession, getUser };
  }

  it("establishes a session in a fresh browser, clearing tokens before network calls", async () => {
    const { client, setSession } = setup(RECOVERY_TOKEN);
    const clear = vi.fn();
    const result = await establishRecoverySession(client,
      "https://dajsrce.test/auth/reset-password#type=recovery&access_token=access&refresh_token=refresh", clear);
    expect(result).toBe("owner@example.test");
    expect(setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(setSession.mock.invocationCallOrder[0]);
  });

  it("uses mail2 from its recovery link even when mail1 was already signed in", async () => {
    const { client, setSession, getSession, getUser } = setup(PASSWORD_TOKEN);
    const mail2Session = {
      access_token: RECOVERY_TOKEN,
      user: { id: "mail2-account", email: "mail2@example.test" },
    };
    setSession.mockImplementation(async () => {
      getSession.mockResolvedValue({ data: { session: mail2Session }, error: null });
      getUser.mockResolvedValue({ data: { user: mail2Session.user }, error: null });
      return { error: null };
    });
    expect(await establishRecoverySession(client,
      "https://dajsrce.test/auth/reset-password#type=recovery&access_token=mail2-access&refresh_token=mail2-refresh", vi.fn()))
      .toBe("mail2@example.test");
    expect(setSession).toHaveBeenCalledWith({ access_token: "mail2-access", refresh_token: "mail2-refresh" });
  });

  it("rejects a different account returned by Auth while verifying recovery", async () => {
    const { client, getUser } = setup(RECOVERY_TOKEN);
    getUser.mockResolvedValue({ data: { user: { id: "other-account", email: "mail1@example.test" } }, error: null });
    expect(await establishRecoverySession(client, "https://dajsrce.test/auth/reset-password", vi.fn())).toBeNull();
  });

  it("accepts the fresh OTP claim actually issued for email recovery", async () => {
    const { client } = setup(fakeAccessToken([{ method: "otp", timestamp: Date.now() / 1000 }]));
    expect(await establishRecoverySession(client,
      "https://dajsrce.test/auth/reset-password#type=recovery&access_token=access&refresh_token=refresh", vi.fn())).toBe("owner@example.test");
    expect(await establishRecoverySession(client, "https://dajsrce.test/auth/reset-password", vi.fn())).toBe("owner@example.test");
  });

  it("rejects stale OTP proof and a session that Auth cannot verify", async () => {
    const old = setup(fakeAccessToken([{ method: "otp", timestamp: Date.now() / 1000 - 7200 }]));
    expect(await establishRecoverySession(old.client, "https://dajsrce.test/auth/reset-password", vi.fn())).toBeNull();
    const invalid = setup(RECOVERY_TOKEN);
    invalid.getUser.mockResolvedValue({ data: { user: null }, error: { code: "session_not_found" } });
    expect(await establishRecoverySession(invalid.client, "https://dajsrce.test/auth/reset-password", vi.fn())).toBeNull();
  });

  it("accepts a verified session established by the server callback", async () => {
    const { client, setSession } = setup(RECOVERY_TOKEN);
    expect(await establishRecoverySession(client, "https://dajsrce.test/auth/reset-password", vi.fn()))
      .toBe("owner@example.test");
    expect(setSession).not.toHaveBeenCalled();
  });

  it("rejects an ordinary signed-in session with no recovery proof, even with no error on the URL", async () => {
    const { client, getSession } = setup(PASSWORD_TOKEN);
    expect(await establishRecoverySession(client, "https://dajsrce.test/auth/reset-password", vi.fn()))
      .toBeNull();
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("rejects a recovery session older than the trust window", async () => {
    const { client } = setup(STALE_RECOVERY_TOKEN);
    expect(await establishRecoverySession(client, "https://dajsrce.test/auth/reset-password", vi.fn()))
      .toBeNull();
  });

  it.each([
    "?error=invalid_recovery", "#error_code=otp_expired", "#type=recovery&access_token=access",
    "#type=signup&access_token=access&refresh_token=refresh",
  ])("rejects a bad link even if another account is already signed in: %s", async (suffix) => {
    const { client, setSession, getSession } = setup(RECOVERY_TOKEN);
    expect(await establishRecoverySession(client, `https://dajsrce.test/auth/reset-password${suffix}`, vi.fn()))
      .toBeNull();
    expect(setSession).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("does not fall back to an existing account after failed token verification", async () => {
    const { client, setSession, getSession } = setup(RECOVERY_TOKEN);
    setSession.mockResolvedValue({ error: { code: "invalid_token" } });
    expect(await establishRecoverySession(client,
      "https://dajsrce.test/auth/reset-password#type=recovery&access_token=bad&refresh_token=bad", vi.fn())).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("rejects an absent or expired session", async () => {
    const { client } = setup(null);
    expect(await establishRecoverySession(client, "https://dajsrce.test/auth/reset-password", vi.fn())).toBeNull();
  });
});
