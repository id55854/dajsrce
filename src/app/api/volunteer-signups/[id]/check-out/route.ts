import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, isUuid, jsonError, rateLimit, requireSameOrigin } from "@/lib/security/http";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const { id: signupId } = await params;
  if (!isUuid(signupId)) {
    return jsonError("Invalid signup id", 400, requestId, NO_STORE);
  }
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "volunteer_signups.check_out", limit: 60, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  const { data, error } = await supabaseAdmin.rpc("volunteer_checkout_transaction", {
    p_actor_id: user.id,
    p_signup_id: signupId,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    logError("volunteer_signups.checkout_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return jsonError("Could not check out this volunteer", status, requestId, NO_STORE);
  }

  const result = data as { checked_out_at?: string; hours?: number; already?: boolean } | null;
  return NextResponse.json({ ok: true, ...result });
}
