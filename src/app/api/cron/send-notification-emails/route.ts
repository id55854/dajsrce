import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bearerMatchesSecret, getCronSecret } from "@/lib/security/runtime";
import { rateLimit } from "@/lib/security/http";
import { getRequestId, logError, logInfo } from "@/lib/observability";
import { emailAppOrigin } from "@/lib/email/volunteer-emails";
import {
  notificationEmailConfig,
  parseNotificationEmailBatches,
  sendNotificationEmail,
  type NotificationEmailOutcome,
} from "@/lib/email/notification-emails";

// A scheduler's GET must reach the handler every time, never a cached answer.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Batches per run: one per recipient, up to ten notifications each. */
const MAX_BATCHES_PER_RUN = 25;
/** Resend accepts two requests a second per team by default. */
const SEND_SPACING_MS = 550;
/** Batches not reached in time go back to the queue instead of being cut off. */
const TIME_BUDGET_MS = 45_000;

/**
 * Sends the e-mail copy of queued in-app notifications (20260928100000).
 * Meant to run every minute. The queue decides who is due (at most one
 * message per person every ten minutes) and every outcome is recorded, so a
 * failed or overlapping run neither loses nor repeats a message.
 */
async function run(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const limited = rateLimit(req, { name: "cron.notification_emails", limit: 10, windowMs: 60_000 }, requestId);
  if (limited) return limited;

  const secret = getCronSecret();
  if (!secret) {
    logError("notification_emails.cron_unconfigured", new Error("CRON_SECRET is missing or weak"), {
      request_id: requestId,
    });
    return NextResponse.json({ error: "Cron is not configured", request_id: requestId }, { status: 503 });
  }
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized", request_id: requestId }, { status: 401 });
  }

  // Without a sender nothing is claimed, so the queue waits intact (and
  // anything older than three days is dropped by the queue, not sent late).
  const config = notificationEmailConfig();
  if (!config) {
    logError("notification_emails.not_configured", new Error("RESEND_API_KEY or RESEND_FROM_EMAIL is missing"), {
      request_id: requestId,
    });
    return NextResponse.json({ error: "E-mail is not configured", request_id: requestId }, { status: 503 });
  }

  const started = Date.now();
  const claim = await supabaseAdmin.rpc("claim_notification_email_batches", { p_limit: MAX_BATCHES_PER_RUN });
  if (claim.error) {
    logError("notification_emails.claim_failed", claim.error, { request_id: requestId });
    return NextResponse.json({ error: "Could not claim e-mails", request_id: requestId }, { status: 500 });
  }

  const batches = parseNotificationEmailBatches(claim.data);
  const sender = new Resend(config.apiKey);
  const appOrigin = emailAppOrigin(req.nextUrl.origin);
  const counts: Record<NotificationEmailOutcome, number> = { sent: 0, retry: 0, skipped: 0 };
  let completionFailures = 0;

  for (const [index, batch] of batches.entries()) {
    const outOfTime = Date.now() - started > TIME_BUDGET_MS;
    const outcome: NotificationEmailOutcome = outOfTime
      ? "retry"
      : await sendNotificationEmail(batch, { config, sender, appOrigin, requestId });
    counts[outcome] += 1;

    const completion = await supabaseAdmin.rpc("complete_notification_email_batch", {
      p_batch_id: batch.batch_id,
      p_outcome: outcome,
      p_error: outOfTime ? "time budget" : outcome === "sent" ? null : `send ${outcome}`,
    });
    if (completion.error) {
      // The rows stay claimed and come due again after their backoff; the
      // idempotency key keeps a delivered message from going out twice.
      completionFailures += 1;
      logError("notification_emails.complete_failed", completion.error, {
        request_id: requestId,
        batch_id: batch.batch_id,
      });
    }

    if (!outOfTime && index < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SEND_SPACING_MS));
    }
  }

  logInfo("notification_emails.run_completed", {
    request_id: requestId,
    batches: batches.length,
    ...counts,
    completion_failures: completionFailures,
  });
  return NextResponse.json({ ok: true, request_id: requestId, batches: batches.length, ...counts });
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
