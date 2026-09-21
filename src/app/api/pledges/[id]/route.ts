import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, isUuid, jsonError, rateLimit, requireSameOrigin } from "@/lib/security/http";

/**
 * The donor withdraws a pledge.
 *
 * Ownership lives inside the transaction, as does its refusal for rows that
 * were marked delivered or acknowledged before those steps were removed from
 * the product; those older rows answer 409 and stay as they are.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const { id: pledgeId } = await params;
  if (!isUuid(pledgeId)) {
    return jsonError("Invalid pledge id", 400, requestId, NO_STORE);
  }
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "pledges.delete", limit: 60, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  const { data, error } = await supabaseAdmin.rpc("cancel_pledge_transaction", {
    p_actor_id: user.id,
    p_pledge_id: pledgeId,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    logError("pledges.cancel_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return jsonError("Pledge could not be cancelled", status, requestId, NO_STORE);
  }

  return NextResponse.json({ ok: true, cancelled: data });
}
