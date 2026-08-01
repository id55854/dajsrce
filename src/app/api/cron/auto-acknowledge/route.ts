import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bearerMatchesSecret, getCronSecret } from "@/lib/security/runtime";
import { getRequestId, logError, logInfo } from "@/lib/observability";

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const secret = getCronSecret();
  if (!secret) {
    logError("auto_acknowledge.cron_unconfigured", new Error("CRON_SECRET is missing or weak"), {
      request_id: requestId,
    });
    return NextResponse.json({ error: "Cron is not configured", request_id: requestId }, { status: 503 });
  }
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized", request_id: requestId }, { status: 401 });
  }

  const days = Math.max(
    1,
    Math.min(365, Number.parseInt(process.env.AUTO_ACKNOWLEDGE_DAYS ?? "14", 10) || 14)
  );
  const { data, error } = await supabaseAdmin.rpc(
    "auto_acknowledge_due_pledges_transaction",
    { p_days: days, p_limit: 500 }
  );

  if (error) {
    logError("auto_acknowledge.transaction_failed", error, { request_id: requestId });
    return NextResponse.json(
      { error: "Auto-acknowledgement failed", request_id: requestId },
      { status: 500 }
    );
  }

  logInfo("auto_acknowledge.run_completed", { request_id: requestId });
  return NextResponse.json({ ok: true, request_id: requestId, ...(data as Record<string, unknown>) });
}
