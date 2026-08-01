import { NextRequest, NextResponse } from "next/server";
import { deliverNearbyNotificationJob, type NearbyNotificationJob } from "@/lib/notify-nearby";
import { getRequestId, logError, logInfo } from "@/lib/observability";
import { bearerMatchesSecret, getCronSecret } from "@/lib/security/runtime";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_JOBS_PER_RUN = 20;

function isJob(value: unknown): value is NearbyNotificationJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<NearbyNotificationJob>;
  return (
    typeof job.id === "string" &&
    typeof job.origin_lat === "number" &&
    typeof job.origin_lng === "number" &&
    typeof job.radius_km === "number" &&
    typeof job.title === "string" &&
    typeof job.body === "string"
  );
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const secret = getCronSecret();
  if (!secret) {
    logError("notification_jobs.cron_unconfigured", new Error("CRON_SECRET is missing"), {
      request_id: requestId,
    });
    return NextResponse.json({ error: "Cron is not configured", request_id: requestId }, { status: 503 });
  }
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized", request_id: requestId }, { status: 401 });
  }

  let processed = 0;
  let delivered = 0;
  let failed = 0;
  for (let index = 0; index < MAX_JOBS_PER_RUN; index += 1) {
    const claim = await supabaseAdmin.rpc("claim_notification_job");
    if (claim.error) {
      logError("notification_jobs.claim_failed", claim.error, { request_id: requestId });
      return NextResponse.json(
        { error: "Could not claim notification job", request_id: requestId },
        { status: 500 }
      );
    }
    if (claim.data === null) break;
    if (!isJob(claim.data)) {
      logError("notification_jobs.invalid_claim", new Error("Invalid job payload"), {
        request_id: requestId,
      });
      return NextResponse.json({ error: "Invalid notification job", request_id: requestId }, { status: 500 });
    }

    processed += 1;
    try {
      const jobDelivered = await deliverNearbyNotificationJob(supabaseAdmin, claim.data);
      const completion = await supabaseAdmin.rpc("complete_notification_job", {
        p_job_id: claim.data.id,
        p_succeeded: true,
        p_delivered_count: jobDelivered,
        p_error: null,
      });
      if (completion.error) throw completion.error;
      delivered += jobDelivered;
    } catch (error) {
      failed += 1;
      logError("notification_jobs.delivery_failed", error, {
        request_id: requestId,
        job_id: claim.data.id,
        attempt_count: claim.data.attempt_count,
      });
      const completion = await supabaseAdmin.rpc("complete_notification_job", {
        p_job_id: claim.data.id,
        p_succeeded: false,
        p_delivered_count: 0,
        p_error: error instanceof Error ? error.message : "Unknown delivery failure",
      });
      if (completion.error) {
        logError("notification_jobs.failure_state_failed", completion.error, {
          request_id: requestId,
          job_id: claim.data.id,
        });
      }
    }
  }

  logInfo("notification_jobs.run_completed", {
    request_id: requestId,
    processed,
    delivered,
    failed,
  });
  return NextResponse.json({ ok: true, processed, delivered, failed, request_id: requestId });
}
