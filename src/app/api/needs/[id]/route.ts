import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import {
  NO_STORE,
  isUuid,
  jsonError,
  rateLimit,
  requireSameOrigin,
  withRequestId,
} from "@/lib/security/http";
import { needFieldFromMessage, parseNeedPatch, type NeedField } from "@/lib/need-patch";

/**
 * The organisation corrects or closes one of its own needs.
 *
 * Editing used to mean delete and re-post, which cascaded every standing
 * pledge away and told each donor their promise was gone. The transaction
 * changes the row in place, refuses a quantity below what is already
 * promised, and decides ownership from the actor's profile, never from the
 * request. `is_fulfilled` closes the need to new pledges or reopens it.
 */
export async function PATCH(
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
    rateLimit(req, { name: "needs.patch", limit: 30, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400, requestId, NO_STORE);
  }
  const parsed = parseNeedPatch(rawBody);
  if (!parsed.ok) return needError(parsed.error, 400, requestId, { field: parsed.field });

  const { data, error } = await supabaseAdmin.rpc("update_need_transaction", {
    p_actor_id: user.id,
    p_need_id: needId,
    p_patch: parsed.value,
  });

  if (error) {
    const status =
      error.code === "42501"
        ? 403
        : error.code === "P0002"
          ? 404
          : error.code === "22023"
            ? 400
            : error.code === "23514"
              ? 409
              : 500;
    logError("needs.update_failed", error, { request_id: requestId, code: error.code ?? null });
    return needError("Need could not be updated", status, requestId, {
      // A quantity below what donors have already promised.
      code: status === 409 ? "quantity_below_pledged" : undefined,
      field: status === 400 ? needFieldFromMessage(error.message) : status === 409 ? "quantity_needed" : null,
    });
  }

  return NextResponse.json({ need: data }, { headers: withRequestId(NO_STORE, requestId) });
}

function needError(
  error: string,
  status: number,
  requestId: string,
  { code, field }: { code?: string; field?: NeedField | null }
) {
  return NextResponse.json(
    { error, ...(code ? { code } : {}), ...(field ? { field } : {}), request_id: requestId },
    { status, headers: withRequestId(NO_STORE, requestId) }
  );
}

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
