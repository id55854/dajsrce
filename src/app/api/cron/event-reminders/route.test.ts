import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, sendVolunteerReminderEmails } = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendVolunteerReminderEmails: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@/lib/email/volunteer-emails", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/volunteer-emails")>()),
  sendVolunteerReminderEmails,
}));

import { GET, POST } from "./route";

const SECRET = "s".repeat(40);
const ROW = {
  user_id: "22222222-2222-4222-8222-222222222222",
  email: "volonter@example.com",
  name: "Ivana",
  event_id: "11111111-1111-4111-8111-111111111111",
  title: "Podjela obroka",
  event_date: "2026-10-01",
  start_time: "09:00:00",
  end_time: "12:00:00",
  location: null,
  institution_name: "Udruga Srce",
  institution_address: "Ilica 1",
  contact_person: null,
  contact_phone: null,
};

function call(method: "GET" | "POST", authorization?: string) {
  const request = new NextRequest("http://localhost/api/cron/event-reminders", {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      // A fresh client address per call keeps the shared rate limiter out of the way.
      "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}`,
    },
  });
  return method === "GET" ? GET(request) : POST(request);
}

describe("/api/cron/event-reminders", () => {
  beforeEach(() => {
    rpc.mockReset();
    sendVolunteerReminderEmails.mockReset();
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(["POST", "GET"] as const)("runs on %s with the bearer secret and reports both channels", async (method) => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    sendVolunteerReminderEmails.mockResolvedValue({ sent: 1, skipped: 0, failed: 0 });
    const response = await call(method, `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, sent: 1, emails: { sent: 1, skipped: 0, failed: 0 } });
    expect(rpc).toHaveBeenCalledWith("send_volunteer_event_reminders_with_recipients");
    expect(sendVolunteerReminderEmails).toHaveBeenCalledWith(
      expect.anything(),
      [ROW],
      expect.objectContaining({ appOrigin: expect.any(String) })
    );
  });

  it.each(["POST", "GET"] as const)("refuses %s without the right secret, before any work", async (method) => {
    expect((await call(method)).status).toBe(401);
    expect((await call(method, "Bearer wrong")).status).toBe(401);
    expect((await call(method, SECRET)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the secret is missing or weak", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect((await call("GET", "Bearer short")).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends no e-mail when the transaction fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    expect((await call("POST", `Bearer ${SECRET}`)).status).toBe(500);
    expect(sendVolunteerReminderEmails).not.toHaveBeenCalled();
  });

  it("reports an empty run when every reminder was already sent today", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    sendVolunteerReminderEmails.mockResolvedValue({ sent: 0, skipped: 0, failed: 0 });
    expect(await (await call("POST", `Bearer ${SECRET}`)).json()).toMatchObject({ sent: 0, emails: { sent: 0 } });
  });
});
