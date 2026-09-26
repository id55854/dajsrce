import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { format, parseISO } from "date-fns";
import { hr } from "date-fns/locale";
import { ORGANISATION } from "@/lib/organisation";
import { logError, logInfo } from "@/lib/observability";
import { readableOrganisationName, volunteerEventPlace } from "@/lib/volunteer-events";

/**
 * Volunteer e-mails: the confirmation right after a signup and the reminder
 * the day before. Both are best effort. An unconfigured sender, a refused
 * address or a Resend outage is logged and counted, never thrown into the
 * signup or the cron run that asked for it; the in-app notice stays the
 * record either way. Messages are Croatian, with an HTML and a plain-text
 * part, and every value that came from a person is escaped.
 */

/**
 * The facts an e-mail states about an event. The address is always the
 * organisation's public projection, so a hidden location is already coarse
 * here and never becomes exact in an inbox.
 */
export type VolunteerEmailEvent = {
  id: string;
  title: string;
  event_date: string;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  requirements?: string | null;
  contact_person?: string | null;
  contact_phone?: string | null;
  institution_name?: string | null;
  institution_address?: string | null;
  institution_city?: string | null;
};

export type VolunteerEmailKind = "signup" | "reminder";
export type VolunteerEmailOutcome = "sent" | "skipped" | "failed";
export type RenderedEmail = { subject: string; html: string; text: string };
export type VolunteerEmailConfig = { apiKey: string; from: string };
type EmailSender = Pick<Resend, "emails">;

export const VOLUNTEER_EMAIL_FOOTER =
  "Ovu poruku primate jer ste se prijavili za volontiranje na DajSrcu. Prijavu možete otkazati na svojoj nadzornoj ploči.";
const ORGANISER_NOTE = "Organizator volontiranja je udruga; ona s vama dogovara sve pojedinosti.";
const SIMPLE_ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A value for one line of a message or a subject: no line breaks, no runs of spaces. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function timeRange(start?: string | null, end?: string | null): string {
  return [start?.slice(0, 5), end?.slice(0, 5)].filter(Boolean).join("–");
}

/**
 * Both variables must be set. There is deliberately no fallback sender: a
 * resend.dev test address would put the message in spam or nowhere.
 */
export function volunteerEmailConfig(env: Record<string, string | undefined> = process.env): VolunteerEmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim();
  return apiKey && from ? { apiKey, from } : null;
}

/** The origin for links in a message: the configured app URL, else the request's own. */
export function emailAppOrigin(fallbackOrigin: string, env: Record<string, string | undefined> = process.env): string {
  try {
    const configured = env.NEXT_PUBLIC_APP_URL?.trim();
    if (configured) return new URL(configured).origin;
  } catch {
    // Fall through to the request origin.
  }
  return new URL(fallbackOrigin).origin;
}

export function renderVolunteerEmail(
  kind: VolunteerEmailKind,
  { recipientName, event, appOrigin }: { recipientName?: string | null; event: VolunteerEmailEvent; appOrigin: string }
): RenderedEmail {
  const title = oneLine(event.title);
  const organiser = event.institution_name?.trim() ? readableOrganisationName(oneLine(event.institution_name)) : null;
  const place = oneLine(volunteerEventPlace(event.location, event.institution_address, event.institution_city));
  const date = format(parseISO(event.event_date), "EEEE, d. MMMM yyyy.", { locale: hr });
  const when = [date, timeRange(event.start_time, event.end_time)].filter(Boolean).join(", ");
  const person = event.contact_person?.trim() ? oneLine(event.contact_person) : null;
  const phone = event.contact_phone?.trim() ? oneLine(event.contact_phone) : null;
  const requirements = event.requirements?.trim() || null;
  const dashboardUrl = `${appOrigin}/dashboard/individual`;
  const name = recipientName?.trim() ? oneLine(recipientName) : null;

  const greeting = name ? `Pozdrav, ${name}!` : "Pozdrav!";
  const intro =
    kind === "signup"
      ? `Prijavili ste se za volontiranje na događaju „${title}”.`
      : `Podsjećamo vas da sutra volontirate na događaju „${title}”.`;
  const subject =
    kind === "signup" ? `Prijava za volontiranje: ${title}` : `Podsjetnik: sutra volontirate – ${title}`;
  const cancelHint = "Ako ipak ne možete doći, otkažite prijavu kako bi se mjesto oslobodilo za drugog volontera.";

  // Label and plain value, plus the HTML value where it differs.
  const rows: { label: string; text: string; html?: string }[] = [
    { label: "Događaj", text: title },
    { label: "Kada", text: when },
  ];
  if (place) rows.push({ label: "Gdje", text: place });
  if (organiser) rows.push({ label: "Organizator", text: organiser });
  if (person || phone) {
    const tel = phone ? phone.replace(/[^\d+]/g, "") : "";
    rows.push({
      label: "Kontakt",
      text: [person, phone].filter(Boolean).join(", "),
      html: [
        person ? escapeHtml(person) : null,
        phone ? `<a href="tel:${escapeHtml(tel)}" style="color:#047857">${escapeHtml(phone)}</a>` : null,
      ].filter(Boolean).join(", "),
    });
  }
  if (requirements) {
    rows.push({
      label: "Što trebate znati ili ponijeti",
      text: requirements,
      html: escapeHtml(requirements).replace(/\r?\n/g, "<br>"),
    });
  }

  const text = [
    greeting,
    "",
    intro,
    ORGANISER_NOTE,
    "",
    ...rows.map((row) => `${row.label}: ${row.text}`),
    "",
    cancelHint,
    `Vaše prijave: ${dashboardUrl}`,
    "",
    "--",
    VOLUNTEER_EMAIL_FOOTER,
  ].join("\n");

  const cell = "padding:6px 0;vertical-align:top";
  const html = `<!doctype html>
<html lang="hr">
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>
<p style="margin:0 0 12px">${escapeHtml(intro)}</p>
<p style="margin:0 0 16px">${escapeHtml(ORGANISER_NOTE)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:15px">
${rows
  .map(
    (row) =>
      `<tr><td style="${cell};padding-right:16px;color:#57534e;white-space:nowrap">${escapeHtml(row.label)}</td><td style="${cell}">${row.html ?? escapeHtml(row.text)}</td></tr>`
  )
  .join("\n")}
</table>
<p style="margin:20px 0 12px">${escapeHtml(cancelHint)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#047857;color:#ffffff;padding:12px 22px;border-radius:9999px;text-decoration:none;font-weight:600">Otvori moje prijave</a></p>
<p style="margin:0;font-size:12px;color:#78716c">${escapeHtml(VOLUNTEER_EMAIL_FOOTER)}</p>
</div>
</body>
</html>`;

  return { subject: oneLine(subject).slice(0, 200), html, text };
}

function isRateLimited(error: { name?: string; statusCode?: number | null } | null): boolean {
  return error?.name === "rate_limit_exceeded" || error?.statusCode === 429;
}

/**
 * Send one volunteer e-mail. Resolves to what happened and never throws.
 * The address is only checked for shape and used; it is never logged.
 */
export async function sendVolunteerEmail(
  kind: VolunteerEmailKind,
  message: {
    to: string | null | undefined;
    recipientName?: string | null;
    event: VolunteerEmailEvent;
    appOrigin: string;
    /** Makes a retried send of the same message a no-op at Resend. */
    idempotencyKey?: string;
  },
  context: {
    requestId: string;
    /** Resolved once per run by batch callers; read from the environment otherwise. */
    config?: VolunteerEmailConfig | null;
    sender?: EmailSender;
    /** Waits before the one retry after a rate limit; tests shorten it. */
    retryDelayMs?: number;
  }
): Promise<VolunteerEmailOutcome> {
  const logContext = { request_id: context.requestId, kind, event_id: message.event.id };
  try {
    const config = context.config === undefined ? volunteerEmailConfig() : context.config;
    if (!config) {
      logError("volunteer_email.not_configured", new Error("RESEND_API_KEY or RESEND_FROM_EMAIL is missing"), logContext);
      return "skipped";
    }
    const to = message.to?.trim() ?? "";
    if (!SIMPLE_ADDRESS.test(to)) {
      logInfo("volunteer_email.no_recipient", logContext);
      return "skipped";
    }
    const rendered = renderVolunteerEmail(kind, message);
    const sender = context.sender ?? new Resend(config.apiKey);
    const payload = {
      from: config.from,
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(ORGANISATION.contactEmail ? { replyTo: ORGANISATION.contactEmail } : {}),
    };
    const options = message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined;
    let { error } = await sender.emails.send(payload, options);
    if (isRateLimited(error)) {
      await new Promise((resolve) => setTimeout(resolve, context.retryDelayMs ?? 1_100));
      ({ error } = await sender.emails.send(payload, options));
    }
    if (error) {
      logError("volunteer_email.delivery_failed", new Error(error.name), { ...logContext, provider_error: error.name });
      return "failed";
    }
    return "sent";
  } catch (error) {
    logError("volunteer_email.delivery_failed", error, logContext);
    return "failed";
  }
}

/** One row of send_volunteer_event_reminders_with_recipients(). */
export type ReminderRecipient = {
  user_id: string;
  email: string | null;
  name: string | null;
  event_id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  institution_name: string | null;
  institution_address: string | null;
  contact_person: string | null;
  contact_phone: string | null;
};

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** The RPC's rows, keeping only well-formed ones. */
export function parseReminderRecipients(data: unknown): ReminderRecipient[] {
  if (!Array.isArray(data)) return [];
  const recipients: ReminderRecipient[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    if (typeof value.user_id !== "string" || typeof value.event_id !== "string") continue;
    if (typeof value.title !== "string" || typeof value.event_date !== "string") continue;
    recipients.push({
      user_id: value.user_id,
      email: textOrNull(value.email),
      name: textOrNull(value.name),
      event_id: value.event_id,
      title: value.title,
      event_date: value.event_date,
      start_time: textOrNull(value.start_time),
      end_time: textOrNull(value.end_time),
      location: textOrNull(value.location),
      institution_name: textOrNull(value.institution_name),
      institution_address: textOrNull(value.institution_address),
      contact_person: textOrNull(value.contact_person),
      contact_phone: textOrNull(value.contact_phone),
    });
  }
  return recipients;
}

type EventExtras = { requirements: string | null; address: string | null; city: string | null };

/**
 * What the reminder states beyond the RPC's row: the requirements, and the
 * organisation's address from its public projection. The RPC's own address
 * column is not used, so a hidden location cannot turn exact here whatever
 * the function projects; if this read fails, the message names the place
 * only when the event has its own.
 */
async function reminderExtras(admin: SupabaseClient, eventIds: string[], requestId: string): Promise<Map<string, EventExtras>> {
  const extras = new Map<string, EventExtras>();
  if (eventIds.length === 0) return extras;
  const { data, error } = await admin
    .from("volunteer_events")
    .select("id, requirements, institution:institutions(address:public_address, city)")
    .in("id", eventIds);
  if (error) {
    logError("volunteer_email.reminder_details_failed", error, { request_id: requestId, code: error.code ?? null });
    return extras;
  }
  for (const row of (data ?? []) as {
    id: string;
    requirements: string | null;
    institution: { address?: string | null; city?: string | null } | { address?: string | null; city?: string | null }[] | null;
  }[]) {
    const institution = Array.isArray(row.institution) ? row.institution[0] : row.institution;
    extras.set(row.id, {
      requirements: row.requirements ?? null,
      address: institution?.address ?? null,
      city: institution?.city ?? null,
    });
  }
  return extras;
}

/**
 * E-mail every reminder the RPC just inserted. Sequential on purpose: the
 * daily volume is small and Resend rate-limits bursts. The RPC returns each
 * recipient once, so a failure here is not retried by the next run; the
 * in-app reminder stands regardless.
 */
export async function sendVolunteerReminderEmails(
  admin: SupabaseClient,
  recipients: ReminderRecipient[],
  context: { requestId: string; appOrigin: string; sender?: EmailSender; retryDelayMs?: number }
): Promise<Record<VolunteerEmailOutcome, number>> {
  const counts: Record<VolunteerEmailOutcome, number> = { sent: 0, skipped: 0, failed: 0 };
  if (recipients.length === 0) return counts;
  const config = volunteerEmailConfig();
  if (!config) {
    logError("volunteer_email.not_configured", new Error("RESEND_API_KEY or RESEND_FROM_EMAIL is missing"), {
      request_id: context.requestId,
      kind: "reminder",
      recipients: recipients.length,
    });
    counts.skipped = recipients.length;
    return counts;
  }
  const extras = await reminderExtras(admin, [...new Set(recipients.map((row) => row.event_id))], context.requestId);
  for (const row of recipients) {
    const extra = extras.get(row.event_id);
    const outcome = await sendVolunteerEmail(
      "reminder",
      {
        to: row.email,
        recipientName: row.name,
        appOrigin: context.appOrigin,
        idempotencyKey: `volunteer-reminder/${row.event_id}/${row.user_id}/${row.event_date}`,
        event: {
          id: row.event_id,
          title: row.title,
          event_date: row.event_date,
          start_time: row.start_time,
          end_time: row.end_time,
          location: row.location,
          requirements: extra?.requirements ?? null,
          contact_person: row.contact_person,
          contact_phone: row.contact_phone,
          institution_name: row.institution_name,
          institution_address: extra?.address ?? null,
          institution_city: extra?.city ?? null,
        },
      },
      { requestId: context.requestId, config, sender: context.sender, retryDelayMs: context.retryDelayMs }
    );
    counts[outcome] += 1;
  }
  return counts;
}
