import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, isUuid, jsonError, rateLimit, requireSameOrigin } from "@/lib/security/http";

/**
 * The volunteer withdraws from an event they have not attended yet.
 *
 * The row is soft-cancelled, never deleted: volunteer_hours references it
 * ON DELETE CASCADE, so deleting would erase ESG evidence. Ownership and the
 * checked-in refusal are decided inside the transaction.
 */
export async function DELETE(
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
    rateLimit(req, { name: "volunteer_signups.delete", limit: 60, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  const { data, error } = await supabaseAdmin.rpc(
    "cancel_volunteer_signup_transaction",
    { p_actor_id: user.id, p_signup_id: signupId }
  );

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    logError("volunteer_signups.cancel_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return jsonError("Signup could not be cancelled", status, requestId, NO_STORE);
  }

  return NextResponse.json({ ok: true, cancelled: data });
}
