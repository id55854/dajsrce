import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from, getUser, send } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc, from } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "hr" }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

import { POST } from "@/app/api/institution-claims/[id]/verify-email/route";

const CLAIM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REGISTRY_EMAIL = "ured@udruga.hr";

let actorSeq = 0;

function signedIn() {
  // A fresh actor per test keeps the per-claim rate limit out of the way.
  actorSeq += 1;
  const id = `11111111-2222-4333-8444-${String(actorSeq).padStart(12, "0")}`;
  getUser.mockResolvedValue({ data: { user: { id } } });
}

function start() {
  return POST(
    new NextRequest(`http://localhost/api/institution-claims/${CLAIM_ID}/verify-email`, {
      method: "POST",
      headers: { "x-forwarded-for": `198.51.100.${actorSeq}` },
    }),
    { params: Promise.resolve({ id: CLAIM_ID }) }
  );
}

function tableRows() {
  from.mockImplementation((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () =>
          table === "profiles"
            ? { data: { name: "Ana Anić" }, error: null }
            : { data: { udr_id: "200307" }, error: null },
      }),
    }),
  }));
}

function rpcStarts(result: Record<string, unknown>) {
  rpc.mockImplementation(async (name: string) =>
    name === "start_institution_claim_email_verification"
      ? { data: { id: CLAIM_ID, status: "email_sent", ...result }, error: null }
      : { data: { name: 'Udruga "Srce"' }, error: null }
  );
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  getUser.mockReset();
  send.mockReset();
  send.mockResolvedValue({ data: { id: "email-1" }, error: null });
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://dajsrce.hr");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM_EMAIL", "DajSrce <noreply@dajsrce.hr>");
  vi.spyOn(console, "error").mockImplementation(() => {});
  tableRows();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/institution-claims/[id]/verify-email", () => {
  it("sends the challenge to the register's address, never the applicant's", async () => {
    signedIn();
    rpcStarts({
      contact_email: REGISTRY_EMAIL,
      registry_email: REGISTRY_EMAIL,
      applicant_contact_email: "applicant@gmail.com",
    });

    const response = await start();
    expect(response.status).toBe(200);
    expect((await response.json()).email_sent).toBe(true);

    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]?.[0] as Record<string, string>;
    expect(message.to).toBe(REGISTRY_EMAIL);
    expect(message.from).toBe("DajSrce <noreply@dajsrce.hr>");
    expect(message.replyTo).toBe("kontakt@dajsrce.hr");
    expect(message.subject).toBe('Potvrdite zahtjev za upravljanje udrugom: Udruga "Srce"');
    expect(message.text).toContain("https://dajsrce.hr/auth/setup#claim_token=");
    expect(message.html).toContain("Udruga &quot;Srce&quot;");
  });

  it("falls back to contact_email on a schema that returns only that", async () => {
    signedIn();
    rpcStarts({ contact_email: REGISTRY_EMAIL });
    await start();
    expect((send.mock.calls[0]?.[0] as { to: string }).to).toBe(REGISTRY_EMAIL);
  });

  it("reports email_sent false instead of using a resend.dev sender", async () => {
    signedIn();
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    rpcStarts({ registry_email: REGISTRY_EMAIL, contact_email: REGISTRY_EMAIL });

    const response = await start();
    expect(response.status).toBe(200);
    expect((await response.json()).email_sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a provider failure as not sent, without treating it as verified", async () => {
    signedIn();
    send.mockResolvedValue({ data: null, error: { message: "domain not verified" } });
    rpcStarts({ registry_email: REGISTRY_EMAIL, contact_email: REGISTRY_EMAIL });
    expect((await (await start()).json()).email_sent).toBe(false);
  });

  it("returns a stable code when the register publishes no address", async () => {
    signedIn();
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "the official register publishes no email for this organisation",
      },
    });
    const response = await start();
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.code).toBe("no_registry_email");
    expect(payload.error).not.toContain("register publishes");
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller before touching the database", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await start();
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
