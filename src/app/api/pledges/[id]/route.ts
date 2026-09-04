import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, isUuid, jsonError, rateLimit, requireSameOrigin } from "@/lib/security/http";

/** Donor or recipient NGO marks a pledge as physically delivered. */
export async function PATCH(
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
    rateLimit(req, { name: "pledges.update", limit: 60, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  let body: { status?: string };
  try {
    body = (await req.json()) as { status?: string };
  } catch {
    return jsonError("Invalid JSON", 400, requestId, NO_STORE);
  }

  if (body.status !== "delivered") {
    return jsonError("Only status=delivered is supported", 400, requestId, NO_STORE);
  }

  const { data: deliveredAt, error } = await supabaseAdmin.rpc(
    "mark_pledge_delivered_transaction",
    { p_actor_id: user.id, p_pledge_id: pledgeId }
  );

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    logError("pledges.mark_delivered_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return jsonError("Pledge could not be marked delivered", status, requestId, NO_STORE);
  }

  return NextResponse.json({ ok: true, delivered_at: deliveredAt });
}

/**
 * The donor withdraws a pledge that is still only a promise. Ownership and the
 * delivered/confirmed refusal both live inside the transaction; a delivered or
 * acknowledged pledge is evidence and is never withdrawn.
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
