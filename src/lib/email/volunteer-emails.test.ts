import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VOLUNTEER_EMAIL_FOOTER,
  emailAppOrigin,
  parseReminderRecipients,
  renderVolunteerEmail,
  sendVolunteerEmail,
  sendVolunteerReminderEmails,
  volunteerEmailConfig,
  type VolunteerEmailEvent,
} from "./volunteer-emails";

const EVENT: VolunteerEmailEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Podjela obroka",
  event_date: "2026-10-01",
  start_time: "09:00:00",
  end_time: "12:00:00",
  location: null,
  requirements: "Udobna obuća\nRukavice",
  contact_person: "Ana Horvat",
  contact_phone: "+385 91 234 5678",
  institution_name: "UDRUGA SRCE ZA SVE",
  institution_address: "Ilica 1",
  institution_city: "Zagreb",
};
const ORIGIN = "https://dajsrce.hr";
const CONFIG = { apiKey: "re_test_key", from: "DajSrce <obavijesti@dajsrce.hr>" };

function fakeSender(...results: { error: { name: string; statusCode: number | null; message: string } | null }[]) {
  const send = vi.fn();
  for (const result of results) send.mockResolvedValueOnce({ data: result.error ? null : { id: "email-id" }, ...result, headers: null });
  send.mockResolvedValue({ data: { id: "email-id" }, error: null, headers: null });
  return { sender: { emails: { send } } as never, send };
}

describe("renderVolunteerEmail", () => {
  it("confirms a signup in Croatian with everything a volunteer needs", () => {
    const { subject, html, text } = renderVolunteerEmail("signup", { recipientName: "Ivana", event: EVENT, appOrigin: ORIGIN });
    expect(subject).toBe("Prijava za volontiranje: Podjela obroka");
    expect(text).toContain("Pozdrav, Ivana!");
    expect(text).toContain("Prijavili ste se za volontiranje na događaju „Podjela obroka”.");
    expect(text).toContain("Kada: četvrtak, 1. listopada 2026., 09:00–12:00");
    expect(text).toContain("Gdje: Ilica 1, Zagreb");
    expect(text).toContain("Organizator: Udruga Srce za Sve");
    expect(text).toContain("Kontakt: Ana Horvat, +385 91 234 5678");
    expect(text).toContain("Što trebate znati ili ponijeti: Udobna obuća\nRukavice");
    expect(text).toContain("Organizator volontiranja je udruga; ona s vama dogovara sve pojedinosti.");
    expect(text).toContain("https://dajsrce.hr/dashboard/individual");
    expect(text.trimEnd().endsWith(VOLUNTEER_EMAIL_FOOTER)).toBe(true);
    expect(html).toContain('lang="hr"');
    expect(html).toContain('href="https://dajsrce.hr/dashboard/individual"');
    expect(html).toContain('href="tel:+385912345678"');
    expect(html).toContain("Udobna obuća<br>Rukavice");
    expect(html).toContain(VOLUNTEER_EMAIL_FOOTER);
  });

  it("words the day-before reminder as a reminder", () => {
    const { subject, text } = renderVolunteerEmail("reminder", { event: EVENT, appOrigin: ORIGIN });
    expect(subject).toBe("Podsjetnik: sutra volontirate – Podjela obroka");
    expect(text).toContain("Pozdrav!");
    expect(text).toContain("Podsjećamo vas da sutra volontirate na događaju „Podjela obroka”.");
  });

  it("escapes everything a person typed and keeps subjects on one line", () => {
    const hostile = {
      ...EVENT,
      title: 'Akcija <script>alert("x")</script>\r\nBcc: someone@example.com',
      location: "<b>Park</b> & \"ulaz\"",
      contact_person: "<img src=x onerror=alert(1)>",
      requirements: null,
      contact_phone: null,
    };
    const { subject, html } = renderVolunteerEmail("signup", { recipientName: "<Ana>", event: hostile, appOrigin: ORIGIN });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Park</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;Park&lt;/b&gt; &amp; &quot;ulaz&quot;");
    expect(html).toContain("Pozdrav, &lt;Ana&gt;!");
  });

  it("uses the event's own place and leaves out what the event does not have", () => {
    const { text } = renderVolunteerEmail("signup", {
      event: { ...EVENT, location: "Park Maksimir, glavni ulaz", requirements: null, contact_person: null, contact_phone: null },
      appOrigin: ORIGIN,
    });
    expect(text).toContain("Gdje: Park Maksimir, glavni ulaz");
    expect(text).not.toContain("Kontakt:");
    expect(text).not.toContain("Što trebate znati");
  });
});

describe("volunteer e-mail configuration", () => {
  it("needs both the key and a real sender, with no fallback address", () => {
    expect(volunteerEmailConfig({ RESEND_API_KEY: "key", RESEND_FROM_EMAIL: "a@b.hr" })).toEqual({ apiKey: "key", from: "a@b.hr" });
    expect(volunteerEmailConfig({ RESEND_API_KEY: "key" })).toBeNull();
    expect(volunteerEmailConfig({ RESEND_FROM_EMAIL: "a@b.hr" })).toBeNull();
    expect(volunteerEmailConfig({ RESEND_API_KEY: " ", RESEND_FROM_EMAIL: "a@b.hr" })).toBeNull();
  });

  it("links to the configured app, else to the request's origin", () => {
    expect(emailAppOrigin("http://localhost:3000/x", { NEXT_PUBLIC_APP_URL: "https://dajsrce.hr/" })).toBe("https://dajsrce.hr");
    expect(emailAppOrigin("http://localhost:3000/x", {})).toBe("http://localhost:3000");
    expect(emailAppOrigin("http://localhost:3000/x", { NEXT_PUBLIC_APP_URL: "not a url" })).toBe("http://localhost:3000");
  });
});

describe("sendVolunteerEmail", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const message = { to: "volonter@example.com", recipientName: "Ivana", event: EVENT, appOrigin: ORIGIN };

  it("sends HTML and text with the contact mailbox as reply-to", async () => {
    const { sender, send } = fakeSender();
    expect(await sendVolunteerEmail("signup", message, { requestId: "req-1", config: CONFIG, sender })).toBe("sent");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: CONFIG.from,
        to: "volonter@example.com",
        replyTo: "kontakt@dajsrce.hr",
        subject: "Prijava za volontiranje: Podjela obroka",
        html: expect.stringContaining("<!doctype html>"),
        text: expect.stringContaining("Podjela obroka"),
      }),
      undefined
    );
  });

  it("skips without a configured sender or a usable address, and never throws", async () => {
    const { sender, send } = fakeSender();
    expect(await sendVolunteerEmail("signup", message, { requestId: "req-1", config: null, sender })).toBe("skipped");
    expect(await sendVolunteerEmail("signup", { ...message, to: "" }, { requestId: "req-1", config: CONFIG, sender })).toBe("skipped");
    expect(await sendVolunteerEmail("signup", { ...message, to: "a@b\nBcc: c@d.hr" }, { requestId: "req-1", config: CONFIG, sender })).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a refusal or an exception as failed, without logging the address", async () => {
    const refused = fakeSender({ error: { name: "validation_error", statusCode: 422, message: "bad" } });
    expect(await sendVolunteerEmail("signup", message, { requestId: "req-1", config: CONFIG, sender: refused.sender })).toBe("failed");
    const throwing = { emails: { send: vi.fn().mockRejectedValue(new Error("network")) } } as never;
    expect(await sendVolunteerEmail("signup", message, { requestId: "req-1", config: CONFIG, sender: throwing })).toBe("failed");
    const logged = vi.mocked(console.error).mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).not.toContain("volonter@example.com");
  });

  it("retries once after a rate limit", async () => {
    const { sender, send } = fakeSender({ error: { name: "rate_limit_exceeded", statusCode: 429, message: "slow down" } });
    expect(
      await sendVolunteerEmail("reminder", { ...message, idempotencyKey: "key-1" }, { requestId: "req-1", config: CONFIG, sender, retryDelayMs: 0 })
    ).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(expect.anything(), { idempotencyKey: "key-1" });
  });
});

describe("reminder e-mails", () => {
  const row = {
    user_id: "22222222-2222-4222-8222-222222222222",
    email: "volonter@example.com",
    name: "Ivana",
    event_id: EVENT.id,
    title: "Podjela obroka",
    event_date: "2026-10-01",
    start_time: "09:00:00",
    end_time: "12:00:00",
    location: null,
    institution_name: "Udruga Srce",
    institution_address: "Točna skrivena adresa 7",
    contact_person: null,
    contact_phone: null,
  };

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("RESEND_API_KEY", CONFIG.apiKey);
    vi.stubEnv("RESEND_FROM_EMAIL", CONFIG.from);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function adminReturning(result: { data: unknown; error: unknown }) {
    const builder = {
      select: vi.fn(() => builder),
      in: vi.fn(() => Promise.resolve(result)),
    };
    return { admin: { from: vi.fn(() => builder) } as unknown as SupabaseClient, builder };
  }

  it("keeps only well-formed rows from the RPC", () => {
    expect(parseReminderRecipients([row, { user_id: 1 }, null, "x"])).toEqual([row]);
    expect(parseReminderRecipients(null)).toEqual([]);
  });

  it("states the public address and the requirements, never the RPC's own address column", async () => {
    const { admin, builder } = adminReturning({
      data: [{ id: EVENT.id, requirements: "Rukavice", institution: { address: "Donji grad", city: "Zagreb" } }],
      error: null,
    });
    const { sender, send } = fakeSender();
    const counts = await sendVolunteerReminderEmails(admin, [row], { requestId: "req-1", appOrigin: ORIGIN, sender });
    expect(counts).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining("address:public_address"));
    const payload = send.mock.calls[0][0] as { text: string; subject: string };
    expect(payload.subject).toBe("Podsjetnik: sutra volontirate – Podjela obroka");
    expect(payload.text).toContain("Gdje: Donji grad, Zagreb");
    expect(payload.text).toContain("Rukavice");
    expect(payload.text).not.toContain("Točna skrivena adresa");
    expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: `volunteer-reminder/${EVENT.id}/${row.user_id}/2026-10-01` });
  });

  it("still sends, without any address, when the public details cannot be read", async () => {
    const { admin } = adminReturning({ data: null, error: { code: "57014" } });
    const { sender, send } = fakeSender();
    await sendVolunteerReminderEmails(admin, [row], { requestId: "req-1", appOrigin: ORIGIN, sender });
    const payload = send.mock.calls[0][0] as { text: string };
    expect(payload.text).not.toContain("Gdje:");
    expect(payload.text).not.toContain("Točna skrivena adresa");
  });

  it("counts every recipient as skipped when e-mail is not configured", async () => {
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    const { admin } = adminReturning({ data: [], error: null });
    const { sender, send } = fakeSender();
    const counts = await sendVolunteerReminderEmails(admin, [row, row], { requestId: "req-1", appOrigin: ORIGIN, sender });
    expect(counts).toEqual({ sent: 0, skipped: 2, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("counts outcomes per recipient", async () => {
    const { admin } = adminReturning({ data: [], error: null });
    const { sender } = fakeSender({ error: null }, { error: { name: "validation_error", statusCode: 422, message: "bad" } });
    const counts = await sendVolunteerReminderEmails(
      admin,
      [row, { ...row, user_id: "u2" }, { ...row, user_id: "u3", email: null }],
      { requestId: "req-1", appOrigin: ORIGIN, sender }
    );
    expect(counts).toEqual({ sent: 1, skipped: 1, failed: 1 });
  });
});
