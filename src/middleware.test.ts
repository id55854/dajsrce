import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { session, getClaims, getSession, getUser } = vi.hoisted(() => {
  const session = {
    claims: null as Record<string, unknown> | null,
    factors: [] as unknown[],
    profile: null as { role: string; institution_id: string | null } | null,
  };
  return {
    session,
    getClaims: vi.fn(async () =>
      session.claims
        ? { data: { claims: session.claims }, error: null }
        : { data: null, error: { message: "no session" } }
    ),
    getSession: vi.fn(async () => ({
      data: { session: session.claims ? { user: { factors: session.factors } } : null },
      error: null,
    })),
    getUser: vi.fn(),
  };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims, getSession, getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: session.profile, error: null }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/data-api/fetch", () => ({
  createDataApiFetch: () => fetch,
  getDataApiUrl: () => "https://data.test",
}));
vi.mock("@/lib/data-api/session", () => ({ sessionDataApiToken: vi.fn() }));

import { middleware } from "./middleware";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const VERIFIED = { id: "f1", factor_type: "totp", status: "verified" };

function signedIn(
  role: string,
  { aal = "aal1", factors = [] as unknown[], institution = null as string | null } = {}
) {
  session.claims = { sub: USER_ID, aal, user_metadata: {} };
  session.factors = factors;
  session.profile = { role, institution_id: institution };
}

async function visit(path: string) {
  const response = await middleware(new NextRequest(`https://dajsrce.test${path}`));
  return response.headers.get("location");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  session.claims = null;
  session.factors = [];
  session.profile = null;
  getSession.mockClear();
  getUser.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dashboard guard: two-step sign-in", () => {
  it("sends an administrator without an authenticator app to the settings to connect one", async () => {
    signedIn("superadmin");
    expect(await visit("/dashboard/admin"))
      .toBe("https://dajsrce.test/dashboard/postavke#dvostupanjska-prijava");
  });

  it("lets that administrator open the settings page to do it", async () => {
    signedIn("superadmin");
    expect(await visit("/dashboard/postavke")).toBeNull();
  });

  it("sends an administrator with an app but an aal1 session to the code", async () => {
    signedIn("superadmin", { factors: [VERIFIED] });
    expect(await visit("/dashboard/admin"))
      .toBe("https://dajsrce.test/auth/mfa?next=%2Fdashboard%2Fadmin");
  });

  it("opens the administration to an aal2 session", async () => {
    signedIn("superadmin", { aal: "aal2", factors: [VERIFIED] });
    expect(await visit("/dashboard/admin")).toBeNull();
  });

  it("keeps any enrolled account's aal1 session off the dashboard, with its destination", async () => {
    signedIn("ngo", { factors: [VERIFIED], institution: "inst-1" });
    expect(await visit("/dashboard/institution/pledges?tab=open"))
      .toBe("https://dajsrce.test/auth/mfa?next=%2Fdashboard%2Finstitution%2Fpledges%3Ftab%3Dopen");
    signedIn("individual", { factors: [VERIFIED] });
    expect(await visit("/dashboard/postavke"))
      .toBe("https://dajsrce.test/auth/mfa?next=%2Fdashboard%2Fpostavke");
  });

  it("asks for the code before NGO onboarding", async () => {
    signedIn("ngo", { factors: [VERIFIED] });
    expect(await visit("/dashboard/ngo")).toBe("https://dajsrce.test/auth/mfa?next=%2Fdashboard%2Fngo");
  });

  it("changes nothing for an account without a verified factor", async () => {
    signedIn("ngo", { institution: "inst-1" });
    expect(await visit("/dashboard/ngo")).toBeNull();
    signedIn("individual", { factors: [{ id: "f2", factor_type: "totp", status: "unverified" }] });
    expect(await visit("/dashboard/individual")).toBeNull();
    signedIn("individual", { aal: "aal2", factors: [VERIFIED] });
    expect(await visit("/dashboard/individual")).toBeNull();
  });

  it("decides the role before the factor, and never calls Supabase Auth", async () => {
    signedIn("ngo", { factors: [VERIFIED], institution: "inst-1" });
    expect(await visit("/dashboard/admin")).toBe("https://dajsrce.test/dashboard");
    expect(getSession).not.toHaveBeenCalled();
    signedIn("individual", { factors: [VERIFIED] });
    await visit("/dashboard/individual");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("still sends a visitor without a session to sign in", async () => {
    expect(await visit("/dashboard/admin"))
      .toBe("https://dajsrce.test/auth/login?next=%2Fdashboard%2Fadmin");
  });
});
