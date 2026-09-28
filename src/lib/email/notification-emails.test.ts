import { describe, expect, it, vi } from "vitest";
import {
  isUnsubscribeToken,
  notificationEmailConfig,
  notificationEmailIdempotencyKey,
  parseNotificationEmailBatches,
  renderNotificationEmail,
  sendNotificationEmail,
  unsubscribeTokenDigest,
  type NotificationEmailBatch,
} from "@/lib/email/notification-emails";

const TOKEN = "a".repeat(64);
const ORIGIN = "https://dajsrce.hr";

function batch(overrides: Partial<NotificationEmailBatch> = {}): NotificationEmailBatch {
  return {
    batch_id: "11111111-1111-4111-8111-111111111111",
    email: "ana@example.com",
    name: "Ana",
    unsubscribe_token: TOKEN,
    items: [
      {
        id: "n1",
        title: "Novo obećanje",
        body: "Ivan je obećao 3 paketa hrane.",
        link: "/dashboard/institution/pledges",
        created_at: "2026-09-28T08:30:00Z",
      },
    ],
    ...overrides,
  };
}

function items(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    title: `Obavijest ${index}`,
    body: "Tekst",
    link: null,
    created_at: "2026-09-28T08:30:00Z",
  }));
}

describe("parseNotificationEmailBatches", () => {
  it("keeps well-formed batches and drops the rest", () => {
    const good = batch();
    const parsed = parseNotificationEmailBatches([
      good,
      { ...good, batch_id: "not-a-uuid" },
      { ...good, unsubscribe_token: "short" },
      { ...good, items: [] },
      { ...good, items: [{ id: "x" }] },
      null,
      "row",
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].items[0].title).toBe("Novo obećanje");
    expect(parseNotificationEmailBatches(null)).toEqual([]);
  });
});

describe("unsubscribe tokens", () => {
  it("accepts only 64 lowercase hex characters and stores their SHA-256 digest", () => {
    expect(isUnsubscribeToken(TOKEN)).toBe(true);
    for (const value of ["A".repeat(64), "a".repeat(63), `${"a".repeat(63)}g`, null, 1]) {
      expect(isUnsubscribeToken(value)).toBe(false);
    }
    expect(unsubscribeTokenDigest("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

describe("renderNotificationEmail", () => {
  it("uses the notification itself as the subject of a single message", () => {
    const rendered = renderNotificationEmail(batch(), { appOrigin: ORIGIN });
    expect(rendered.subject).toBe("Novo obećanje");
    expect(rendered.text).toContain("Pozdrav, Ana!");
    expect(rendered.text).toContain("Na DajSrcu imate novu obavijest:");
    expect(rendered.text).toContain("https://dajsrce.hr/dashboard/institution/pledges");
    expect(rendered.html).toContain('href="https://dajsrce.hr/dashboard/institution/pledges"');
  });

  it("counts several notifications in Croatian", () => {
    expect(renderNotificationEmail(batch({ items: items(2) }), { appOrigin: ORIGIN }).subject).toBe(
      "Imate 2 nove obavijesti na DajSrcu"
    );
    expect(renderNotificationEmail(batch({ items: items(5) }), { appOrigin: ORIGIN }).subject).toBe(
      "Imate 5 novih obavijesti na DajSrcu"
    );
    expect(renderNotificationEmail(batch({ items: items(10) }), { appOrigin: ORIGIN }).text).toContain(
      "Na DajSrcu imate 10 novih obavijesti:"
    );
  });

  it("escapes what people wrote and never links outside the site", () => {
    const rendered = renderNotificationEmail(
      batch({
        name: "<b>Ana</b>",
        items: [
          {
            id: "n1",
            title: 'Potreba "<script>"',
            body: "a <img src=x onerror=alert(1)>",
            link: "https://evil.example/phish",
            created_at: "",
          },
          { id: "n2", title: "Druga", body: "b", link: "//evil.example", created_at: "" },
        ],
      }),
      { appOrigin: ORIGIN }
    );
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).not.toContain("<b>Ana</b>");
    expect(rendered.html).not.toContain("evil.example");
    expect(rendered.text).not.toContain("evil.example");
  });

  it("offers a confirmed opt-out in the body and RFC 8058 one-click in the headers", () => {
    const rendered = renderNotificationEmail(batch(), { appOrigin: ORIGIN });
    expect(rendered.text).toContain(`https://dajsrce.hr/obavijesti/odjava?t=${TOKEN}`);
    expect(rendered.text).toContain("https://dajsrce.hr/dashboard/postavke");
    expect(rendered.headers["List-Unsubscribe"]).toBe(
      `<https://dajsrce.hr/api/notification-emails/unsubscribe?t=${TOKEN}>`
    );
    expect(rendered.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});

describe("notificationEmailIdempotencyKey", () => {
  it("is the same for the same notifications in any order", () => {
    const one = batch({ items: items(3) });
    const reordered = batch({ items: [...items(3)].reverse(), unsubscribe_token: "b".repeat(64) });
    expect(notificationEmailIdempotencyKey(one)).toBe(notificationEmailIdempotencyKey(reordered));
    expect(notificationEmailIdempotencyKey(one)).not.toBe(
      notificationEmailIdempotencyKey(batch({ items: items(2) }))
    );
    expect(notificationEmailIdempotencyKey(one)).toMatch(/^notification-email\/[0-9a-f]{64}$/);
  });
});

describe("sendNotificationEmail", () => {
  const config = { apiKey: "re_test", from: "DajSrce <obavijesti@dajsrce.hr>" };

  function sender(...results: Array<{ error: { name: string; statusCode?: number } | null }>) {
    const send = vi.fn();
    for (const result of results) send.mockResolvedValueOnce({ data: result.error ? null : { id: "e1" }, ...result });
    return { send, emails: { send } } as unknown as { send: ReturnType<typeof vi.fn> } & {
      emails: { send: ReturnType<typeof vi.fn> };
    };
  }

  async function outcome(s: ReturnType<typeof sender>, overrides: Partial<NotificationEmailBatch> = {}) {
    return sendNotificationEmail(batch(overrides), {
      config,
      sender: s as never,
      appOrigin: ORIGIN,
      requestId: "req",
      retryDelayMs: 0,
    });
  }

  it("sends from the configured sender with a reply-to, headers and a stable key", async () => {
    const s = sender({ error: null });
    expect(await outcome(s)).toBe("sent");
    const [payload, options] = s.send.mock.calls[0];
    expect(payload).toMatchObject({
      from: config.from,
      to: "ana@example.com",
      replyTo: "kontakt@dajsrce.hr",
      subject: "Novo obećanje",
    });
    expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(options.idempotencyKey).toMatch(/^notification-email\//);
  });

  it("retries once after a rate limit", async () => {
    const s = sender({ error: { name: "rate_limit_exceeded", statusCode: 429 } }, { error: null });
    expect(await outcome(s)).toBe("sent");
    expect(s.send).toHaveBeenCalledTimes(2);
  });

  it("treats an already accepted key as delivered", async () => {
    expect(await outcome(sender({ error: { name: "invalid_idempotent_request" } }))).toBe("sent");
  });

  it("skips what no retry fixes and retries the rest", async () => {
    expect(await outcome(sender({ error: { name: "validation_error" } }))).toBe("skipped");
    expect(await outcome(sender({ error: { name: "application_error" } }))).toBe("retry");
    expect(await outcome(sender(), { email: "not an address" })).toBe("skipped");
  });
});

describe("notificationEmailConfig", () => {
  it("needs both Resend variables and has no fallback sender", () => {
    expect(notificationEmailConfig({ RESEND_API_KEY: "k" })).toBeNull();
    expect(notificationEmailConfig({ RESEND_FROM_EMAIL: "a@dajsrce.hr" })).toBeNull();
    expect(notificationEmailConfig({ RESEND_API_KEY: " k ", RESEND_FROM_EMAIL: " a@dajsrce.hr " })).toEqual({
      apiKey: "k",
      from: "a@dajsrce.hr",
    });
  });
});
