import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, resetPasswordForEmail } = vi.hoisted(() => ({
  createClient: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@/lib/env", () => ({
  getSupabasePublicConfig: () => ({
    url: "https://project.supabase.co",
    anonKey: "anon-key",
  }),
  requireEnvironmentVariable: (key: string) => {
    if (key !== "NEXT_PUBLIC_APP_URL") throw new Error(`Unexpected key: ${key}`);
    return "https://trusted.dajsrce.test/deployment/path";
  },
}));

import { sendPasswordRecovery } from "./password-recovery-server";

beforeEach(() => {
  vi.clearAllMocks();
  resetPasswordForEmail.mockResolvedValue({ error: null });
  createClient.mockReturnValue({ auth: { resetPasswordForEmail } });
});

describe("server password recovery", () => {
  it("uses only the configured application origin for the recovery redirect", async () => {
    await sendPasswordRecovery("person@example.test");

    expect(resetPasswordForEmail).toHaveBeenCalledWith("person@example.test", {
      redirectTo:
        "https://trusted.dajsrce.test/auth/callback?next=%2Fauth%2Freset-password",
    });
    expect(createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "anon-key",
      expect.objectContaining({
        auth: expect.objectContaining({
          flowType: "implicit",
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        }),
      })
    );
  });
});
