import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, sendNotificationEmail } = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendNotificationEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@/lib/email/notification-emails", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/notification-emails")>()),
  sendNotificationEmail,
}));

import { GET, POST } from "./route";

const SECRET = "s".repeat(40);

function batch(id: string) {
  return {
    batch_id: id,
    email: "ana@example.com",
    name: "Ana",
    unsubscribe_token: "a".repeat(64),
    items: [{ id: `n-${id}`, title: "Novo obećanje", body: "Tekst", link: null, created_at: "2026-09-28T08:00:00Z" }],
  };
}

function call(method: "GET" | "POST", authorization?: string) {
  return new NextRequest("http://localhost/api/cron/send-notification-emails", {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}`,
    },
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_FROM_EMAIL", "DajSrce <obavijesti@dajsrce.hr>");
  rpc.mockReset();
  sendNotificationEmail.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("send-notification-emails cron", () => {
  it("refuses a caller without the secret", async () => {
    expect((await GET(call("GET"))).status).toBe(401);
    expect((await POST(call("POST", "Bearer wrong"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("claims nothing while e-mail is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const response = await GET(call("GET", `Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends each claimed batch and records every outcome", async () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    rpc.mockImplementation(async (name: string) =>
      name === "claim_notification_email_batches"
        ? { data: [batch(first), batch(second)], error: null }
        : { data: 1, error: null }
    );
    sendNotificationEmail.mockResolvedValueOnce("sent").mockResolvedValueOnce("retry");

    const response = await GET(call("GET", `Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ batches: 2, sent: 1, retry: 1, skipped: 0 });
    expect(rpc).toHaveBeenCalledWith("claim_notification_email_batches", { p_limit: 25 });
    expect(rpc).toHaveBeenCalledWith("complete_notification_email_batch", {
      p_batch_id: first,
      p_outcome: "sent",
      p_error: null,
    });
    expect(rpc).toHaveBeenCalledWith("complete_notification_email_batch", {
      p_batch_id: second,
      p_outcome: "retry",
      p_error: "send retry",
    });
  });

  it("fails loudly when the queue cannot be claimed", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    expect((await POST(call("POST", `Bearer ${SECRET}`))).status).toBe(500);
    expect(sendNotificationEmail).not.toHaveBeenCalled();
  });
});
