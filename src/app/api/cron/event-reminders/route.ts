import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bearerMatchesSecret, getCronSecret } from "@/lib/security/runtime";
import { getRequestId, logError, logInfo } from "@/lib/observability";

/** Reminds tomorrow's signed-up volunteers. Meant to run once a day. */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
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

  const { data, error } = await supabaseAdmin.rpc("send_volunteer_event_reminders");

  if (error) {
    logError("event_reminders.transaction_failed", error, { request_id: requestId });
    return NextResponse.json(
      { error: "Event reminders failed", request_id: requestId },
      { status: 500 }
    );
  }

  logInfo("event_reminders.run_completed", { request_id: requestId, sent: data });
  return NextResponse.json({ ok: true, request_id: requestId, sent: data });
}
