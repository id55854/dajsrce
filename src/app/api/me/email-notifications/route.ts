import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, jsonError, rateLimit, requireSameOrigin } from "@/lib/security/http";

export const dynamic = "force-dynamic";

/**
 * Turns the e-mail copy of in-app notifications on or off for the signed-in
 * account. A mutation, so the user comes from `auth.getUser()`; the RPC
 * updates only that user's own profile and drops anything still queued when
 * e-mail is turned off.
 */
export async function PATCH(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "me.email_notifications", limit: 20, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Not authenticated", 401, requestId, NO_STORE);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400, requestId, NO_STORE);
  }
  const enabled = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") {
    return jsonError("enabled must be true or false", 400, requestId, NO_STORE);
  }

  const { data, error } = await supabaseAdmin.rpc("set_email_notifications", {
    p_actor_id: user.id,
    p_enabled: enabled,
  });
  if (error) {
    logError("me.email_notifications_failed", error, { request_id: requestId, code: error.code ?? null });
    return jsonError("The setting could not be saved", 500, requestId, NO_STORE);
  }

  return NextResponse.json(
    { enabled: data === true, request_id: requestId },
    { headers: { ...NO_STORE, "x-request-id": requestId } }
  );
}
