import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, isUuid, jsonError, rateLimit, requireSameOrigin } from "@/lib/security/http";

/**
 * The organisation deletes one of its own needs.
 *
 * Pledges under it cascade away, so the transaction first notifies every donor
 * with a standing pledge and audits the counts. Ownership is decided inside
 * the transaction from the actor's profile, never from the request.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const { id: needId } = await params;
  if (!isUuid(needId)) {
    return jsonError("Invalid need id", 400, requestId, NO_STORE);
  }
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "needs.delete", limit: 30, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  const { data, error } = await supabaseAdmin.rpc("delete_need_transaction", {
    p_actor_id: user.id,
    p_need_id: needId,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    logError("needs.delete_failed", error, { request_id: requestId, code: error.code ?? null });
    return jsonError("Need could not be deleted", status, requestId, NO_STORE);
  }

  return NextResponse.json({ ok: true, deleted: data }, { headers: NO_STORE });
}
