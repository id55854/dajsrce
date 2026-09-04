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
  const { id: pledgeId } = await params;
  if (!isUuid(pledgeId)) {
    return jsonError("Invalid pledge id", 400, requestId, NO_STORE);
  }
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "pledges.acknowledge", limit: 60, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  let notes: string | undefined;
  try {
    const body = (await req.json()) as { notes?: string };
    notes = body.notes;
  } catch {
    notes = undefined;
  }

  if (notes != null && (typeof notes !== "string" || notes.length > 2000)) {
    return jsonError("notes must be at most 2000 characters", 400, requestId, NO_STORE);
  }

  const { data, error } = await supabaseAdmin.rpc("acknowledge_pledge_transaction", {
    p_actor_id: user.id,
    p_pledge_id: pledgeId,
    p_notes: notes?.trim() || null,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    logError("pledges.acknowledge_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return jsonError("Pledge could not be acknowledged", status, requestId, NO_STORE);
  }

  return NextResponse.json({ acknowledgement: data });
}
