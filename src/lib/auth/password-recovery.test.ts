import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, resetPasswordForEmail } = vi.hoisted(() => {
  const resetPasswordForEmail = vi.fn();
  return { resetPasswordForEmail, createClient: vi.fn(() => ({ auth: { resetPasswordForEmail } })) };
});
vi.mock("@supabase/supabase-js", () => ({ createClient }));
import { establishRecoverySession, sendPasswordRecovery } from "./password-recovery";

beforeEach(() => { vi.clearAllMocks(); });

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

  function setup() {
    const setSession = vi.fn().mockResolvedValue({ error: null });
    const getUser = vi.fn().mockResolvedValue({ data: { user: { email: "owner@example.test" } }, error: null });
    const client = { auth: { setSession, getUser } } as unknown as SupabaseClient;
    return { client, setSession, getUser };
  }

  it("establishes a session in a fresh browser, clearing tokens before network calls", async () => {
    const { client, setSession, getUser } = setup();
    const clear = vi.fn();
    const result = await establishRecoverySession(client,
      "https://dajsrce.test/auth/reset-password#type=recovery&access_token=access&refresh_token=refresh", clear);
    expect(result).toBe("owner@example.test");
    expect(setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(setSession.mock.invocationCallOrder[0]);
    expect(getUser).toHaveBeenCalledOnce();
  });

  it("accepts a verified session established by the server callback", async () => {
    const { client, setSession } = setup();
    expect(await establishRecoverySession(client, "https://dajsrce.test/auth/reset-password", vi.fn()))
      .toBe("owner@example.test");
    expect(setSession).not.toHaveBeenCalled();
  });

  it.each([
    "?error=invalid_recovery", "#error_code=otp_expired", "#type=recovery&access_token=access",
    "#type=signup&access_token=access&refresh_token=refresh",
  ])("rejects a bad link even if another account is already signed in: %s", async (suffix) => {
    const { client, setSession, getUser } = setup();
    expect(await establishRecoverySession(client, `https://dajsrce.test/auth/reset-password${suffix}`, vi.fn()))
      .toBeNull();
    expect(setSession).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("does not fall back to an existing account after failed token verification", async () => {
    const { client, setSession, getUser } = setup();
    setSession.mockResolvedValue({ error: { code: "invalid_token" } });
    expect(await establishRecoverySession(client,
      "https://dajsrce.test/auth/reset-password#type=recovery&access_token=bad&refresh_token=bad", vi.fn())).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects an absent or expired session", async () => {
    const { client, getUser } = setup();
    getUser.mockResolvedValue({ data: { user: null }, error: { code: "session_not_found" } });
    expect(await establishRecoverySession(client, "https://dajsrce.test/auth/reset-password", vi.fn())).toBeNull();
  });
});
