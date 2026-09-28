import { createHash } from "node:crypto";
import type { Resend } from "resend";
import { ORGANISATION } from "@/lib/organisation";
import { logError } from "@/lib/observability";
import { safeInternalPath } from "@/lib/security/redirects";

/**
 * The e-mail copy of in-app notifications (20260928100000). The database
 * queues one row per notification and hands the worker one batch per
 * recipient: up to ten notifications, at most one message every ten minutes,
 * so a burst of pledges becomes one e-mail. Messages are Croatian, with an
 * HTML and a plain-text part; every value that came from a person is
 * escaped, and only internal links become buttons.
 */

type EmailSender = Pick<Resend, "emails">;

export type NotificationEmailConfig = { apiKey: string; from: string };

export type NotificationEmailItem = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
};

/** One row of claim_notification_email_batches(). */
export type NotificationEmailBatch = {
  batch_id: string;
  email: string;
  name: string | null;
  /** Raw token; only its SHA-256 digest is stored. */
  unsubscribe_token: string;
  items: NotificationEmailItem[];
};

/** What happened to one batch, as complete_notification_email_batch() records it. */
export type NotificationEmailOutcome = "sent" | "retry" | "skipped";

export const NOTIFICATION_EMAIL_FOOTER =
  "Ove obavijesti primate jer imate račun na DajSrcu. Obavijesti u aplikaciji ostaju i kad isključite e-poštu.";

const UNSUBSCRIBE_TOKEN = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIMPLE_ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** Resend errors that no retry will fix for this message. */
const PERMANENT_ERRORS = new Set(["validation_error", "invalid_parameter"]);

export function isUnsubscribeToken(value: unknown): value is string {
  return typeof value === "string" && UNSUBSCRIBE_TOKEN.test(value);
}

/** The digest the database stores for an unsubscribe token. */
export function unsubscribeTokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Both Resend variables, as for every other message; no fallback sender. */
export function notificationEmailConfig(
  env: Record<string, string | undefined> = process.env
): NotificationEmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim();
  return apiKey && from ? { apiKey, from } : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** The RPC's batches, keeping only well-formed ones. */
export function parseNotificationEmailBatches(data: unknown): NotificationEmailBatch[] {
  if (!Array.isArray(data)) return [];
  const batches: NotificationEmailBatch[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    if (typeof value.batch_id !== "string" || !UUID.test(value.batch_id)) continue;
    if (typeof value.email !== "string" || !isUnsubscribeToken(value.unsubscribe_token)) continue;
    if (!Array.isArray(value.items)) continue;
    const items: NotificationEmailItem[] = [];
    for (const raw of value.items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.body !== "string") {
        continue;
      }
      items.push({
        id: item.id,
        title: item.title,
        body: item.body,
        link: text(item.link),
        created_at: text(item.created_at) ?? "",
      });
    }
    if (items.length === 0) continue;
    batches.push({
      batch_id: value.batch_id,
      email: value.email,
      name: text(value.name),
      unsubscribe_token: value.unsubscribe_token,
      items,
    });
  }
  return batches;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Croatian plural: 1 obavijest, 2-4 obavijesti (nove), 5+ (novih), 21 like 1. */
function croatianCount(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return `${count} novu obavijest`;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} nove obavijesti`;
  return `${count} novih obavijesti`;
}

function when(value: string): string | null {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("hr-HR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zagreb",
  }).format(date);
}

export type RenderedNotificationEmail = {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

export function renderNotificationEmail(
  batch: NotificationEmailBatch,
  { appOrigin }: { appOrigin: string }
): RenderedNotificationEmail {
  const count = batch.items.length;
  const name = batch.name?.trim() ? oneLine(batch.name) : null;
  const greeting = name ? `Pozdrav, ${name}!` : "Pozdrav!";
  const intro =
    count === 1 ? "Na DajSrcu imate novu obavijest:" : `Na DajSrcu imate ${croatianCount(count)}:`;
  const subject =
    count === 1 ? oneLine(batch.items[0].title) : `Imate ${croatianCount(count)} na DajSrcu`;
  const token = encodeURIComponent(batch.unsubscribe_token);
  const unsubscribeUrl = `${appOrigin}/obavijesti/odjava?t=${token}`;
  const oneClickUrl = `${appOrigin}/api/notification-emails/unsubscribe?t=${token}`;
  const settingsUrl = `${appOrigin}/dashboard/postavke`;
  const dashboardUrl = `${appOrigin}/dashboard`;

  const items = batch.items.map((item) => {
    const path = safeInternalPath(item.link, "");
    return {
      title: oneLine(item.title),
      body: item.body.trim(),
      when: when(item.created_at),
      url: path ? `${appOrigin}${path}` : null,
    };
  });

  const textPart = [
    greeting,
    "",
    intro,
    "",
    ...items.flatMap((item) => [
      item.title,
      item.body,
      ...(item.when ? [item.when] : []),
      ...(item.url ? [item.url] : []),
      "",
    ]),
    `Sve obavijesti: ${dashboardUrl}`,
    "",
    "--",
    NOTIFICATION_EMAIL_FOOTER,
    `Postavke računa: ${settingsUrl}`,
    `Isključi obavijesti e-poštom: ${unsubscribeUrl}`,
  ].join("\n");

  const button =
    "display:inline-block;background:#b91c1c;color:#ffffff;padding:10px 20px;border-radius:9999px;text-decoration:none;font-weight:600";
  const html = `<!doctype html>
<html lang="hr">
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#b91c1c">DajSrce</p>
<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>
<p style="margin:0 0 16px">${escapeHtml(intro)}</p>
${items
  .map(
    (item) => `<div style="border-top:1px solid #e7e5e4;padding:14px 0">
<p style="margin:0 0 4px;font-weight:700">${escapeHtml(item.title)}</p>
<p style="margin:0 0 6px">${escapeHtml(item.body).replace(/\r?\n/g, "<br>")}</p>
${item.when ? `<p style="margin:0 0 8px;font-size:13px;color:#78716c">${escapeHtml(item.when)}</p>` : ""}
${item.url ? `<p style="margin:0"><a href="${escapeHtml(item.url)}" style="${button}">Otvori</a></p>` : ""}
</div>`
  )
  .join("\n")}
<p style="margin:16px 0 24px;border-top:1px solid #e7e5e4;padding-top:16px"><a href="${escapeHtml(dashboardUrl)}" style="color:#b91c1c;font-weight:600">Sve obavijesti na DajSrcu</a></p>
<p style="margin:0 0 8px;font-size:12px;color:#78716c">${escapeHtml(NOTIFICATION_EMAIL_FOOTER)} <a href="${escapeHtml(settingsUrl)}" style="color:#78716c">Postavke računa</a> · <a href="${escapeHtml(unsubscribeUrl)}" style="color:#78716c">Isključi obavijesti e-poštom</a></p>
<p style="margin:0;font-size:12px;color:#78716c">DajSrce · Udruga za digitalnu solidarnost DajSrce · ${escapeHtml(ORGANISATION.contactEmail ?? "kontakt@dajsrce.hr")}</p>
</div>
</body>
</html>`;

  return {
    subject: subject.slice(0, 200),
    html,
    text: textPart,
    // RFC 8058 one-click unsubscribe; the page link in the body confirms first.
    headers: {
      "List-Unsubscribe": `<${oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/**
 * The same set of notifications always has the same key, so a batch that is
 * re-claimed after a crash is not delivered twice (Resend keeps keys a day).
 */
export function notificationEmailIdempotencyKey(batch: NotificationEmailBatch): string {
  const ids = batch.items.map((item) => item.id).sort().join(",");
  return `notification-email/${createHash("sha256").update(ids, "utf8").digest("hex")}`;
}

function isRateLimited(error: { name?: string; statusCode?: number | null } | null): boolean {
  return error?.name === "rate_limit_exceeded" || error?.statusCode === 429;
}

/**
 * Send one batch. Resolves to what the queue should record and never throws.
 * The address is only checked for shape and used; it is never logged.
 */
export async function sendNotificationEmail(
  batch: NotificationEmailBatch,
  context: {
    config: NotificationEmailConfig;
    sender: EmailSender;
    appOrigin: string;
    requestId: string;
    /** Waits before the one retry after a rate limit; tests shorten it. */
    retryDelayMs?: number;
  }
): Promise<NotificationEmailOutcome> {
  const logContext = { request_id: context.requestId, batch_id: batch.batch_id, items: batch.items.length };
  try {
    const to = batch.email.trim();
    if (!SIMPLE_ADDRESS.test(to)) return "skipped";
    const rendered = renderNotificationEmail(batch, { appOrigin: context.appOrigin });
    const payload = {
      from: context.config.from,
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: rendered.headers,
      ...(ORGANISATION.contactEmail ? { replyTo: ORGANISATION.contactEmail } : {}),
    };
    const options = { idempotencyKey: notificationEmailIdempotencyKey(batch) };
    let { error } = await context.sender.emails.send(payload, options);
    if (isRateLimited(error)) {
      await new Promise((resolve) => setTimeout(resolve, context.retryDelayMs ?? 1_100));
      ({ error } = await context.sender.emails.send(payload, options));
    }
    if (!error) return "sent";
    // The same key with a different payload means an earlier attempt of this
    // exact set was accepted (only the unsubscribe token differs): delivered.
    if (error.name === "invalid_idempotent_request") return "sent";
    logError("notification_email.delivery_failed", new Error(error.name), {
      ...logContext,
      provider_error: error.name,
    });
    return PERMANENT_ERRORS.has(error.name) ? "skipped" : "retry";
  } catch (error) {
    logError("notification_email.delivery_failed", error, logContext);
    return "retry";
  }
}
