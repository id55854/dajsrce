import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, isUuid, jsonError, rateLimit, requireSameOrigin, withRequestId } from "@/lib/security/http";

/**
 * Issue a short-lived bearer token for an institution's onsite QR code.
 * Only the hash is stored. Tokens are available from the day before the event
 * through the event day so an old public event URL is not a check-in proof.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const { id: eventId } = await params;
  if (!isUuid(eventId)) {
    return jsonError("Invalid event id", 400, requestId, NO_STORE);
  }
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "volunteer_events.check_in_token", limit: 20, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  const [{ data: profile }, { data: event }] = await Promise.all([
    supabase.from("profiles").select("role, institution_id").eq("id", user.id).maybeSingle(),
    supabase
      .from("volunteer_events")
      .select("id, institution_id, event_date")
      .eq("id", eventId)
      .maybeSingle(),
  ]);
  if (!profile || profile.role !== "ngo" || !profile.institution_id) {
    return jsonError("Institution access required", 403, requestId, NO_STORE);
  }
  if (!event || event.institution_id !== profile.institution_id) {
    return jsonError("Event not found", 404, requestId, NO_STORE);
  }

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const eventUtc = Date.parse(`${event.event_date}T00:00:00.000Z`);
  const day = 24 * 60 * 60 * 1000;
  if (!Number.isFinite(eventUtc) || eventUtc < todayUtc - day || eventUtc > todayUtc + day) {
    return NextResponse.json(
      { error: "The onsite QR code becomes available one day before the event", request_id: requestId },
      { status: 409, headers: withRequestId(NO_STORE, requestId) }
    );
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const eventDayExpiry = Date.parse(`${event.event_date}T23:59:59.999Z`);
  const expiresAt = new Date(Math.min(eventDayExpiry + 3 * 60 * 60 * 1000, Date.now() + day)).toISOString();

  const { error } = await supabaseAdmin.from("volunteer_checkin_tokens").insert({
    event_id: eventId,
    token_hash: tokenHash,
    created_by: user.id,
    expires_at: expiresAt,
  });
  if (error) {
    logError("volunteer_events.check_in_token_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return jsonError("Could not create the check-in code", 500, requestId, NO_STORE);
  }

  return NextResponse.json(
    { token, expires_at: expiresAt, request_id: requestId },
    { headers: withRequestId(NO_STORE, requestId) }
  );
}
