import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bearerMatchesSecret, getCronSecret } from "@/lib/security/runtime";
import { rateLimit } from "@/lib/security/http";
import { getRequestId, logError, logInfo } from "@/lib/observability";
import {
  emailAppOrigin,
  parseReminderRecipients,
  sendVolunteerReminderEmails,
} from "@/lib/email/volunteer-emails";

// A scheduler's GET must reach the handler every time, never a cached answer.
export const dynamic = "force-dynamic";

/**
 * Reminds tomorrow's signed-up volunteers, in the app and by e-mail. Meant
 * to run once a day. The transaction inserts the in-app reminders and
 * returns only the recipients it inserted a reminder for just now, so a
 * second run the same day sends nothing twice.
 */
async function run(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const limited = rateLimit(req, { name: "cron.event_reminders", limit: 10, windowMs: 60_000 }, requestId);
  if (limited) return limited;

  const secret = getCronSecret();
  if (!secret) {
    logError("event_reminders.cron_unconfigured", new Error("CRON_SECRET is missing or weak"), {
      request_id: requestId,
    });
    return NextResponse.json({ error: "Cron is not configured", request_id: requestId }, { status: 503 });
  }
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized", request_id: requestId }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc("send_volunteer_event_reminders_with_recipients");

  if (error) {
    logError("event_reminders.transaction_failed", error, { request_id: requestId });
    return NextResponse.json(
      { error: "Event reminders failed", request_id: requestId },
      { status: 500 }
    );
  }

  const recipients = parseReminderRecipients(data);
  const emails = await sendVolunteerReminderEmails(supabaseAdmin, recipients, {
    requestId,
    appOrigin: emailAppOrigin(req.nextUrl.origin),
  });

  logInfo("event_reminders.run_completed", {
    request_id: requestId,
    sent: recipients.length,
    emails_sent: emails.sent,
    emails_skipped: emails.skipped,
    emails_failed: emails.failed,
  });
  // `sent` stays the number of in-app reminders, as before.
  return NextResponse.json({ ok: true, request_id: requestId, sent: recipients.length, emails });
}

/** GitHub Actions and other schedulers POST with `Authorization: Bearer <CRON_SECRET>`. */
export async function POST(req: NextRequest) {
  return run(req);
}

/**
 * Vercel Cron sends a GET with the same bearer header. The check is the same
 * constant-time comparison, so the method adds no way in.
 */
export async function GET(req: NextRequest) {
  return run(req);
}
