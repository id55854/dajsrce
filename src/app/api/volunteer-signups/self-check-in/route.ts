import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import {
  NO_STORE,
  isBase64UrlToken,
  isUuid,
  jsonError,
  rateLimit,
  requireSameOrigin,
} from "@/lib/security/http";

/** Volunteer marks arrival for an event they signed up for (QR flow). */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "volunteer_signups.self_check_in", limit: 30, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  let eventId: string;
  let token: string;
  try {
    const body = (await req.json()) as { event_id?: string; token?: string };
    if (!isUuid(body.event_id)) {
      throw new Error("bad");
    }
    if (!isBase64UrlToken(body.token)) {
      throw new Error("bad");
    }
    eventId = body.event_id;
    token = body.token;
  } catch {
    return jsonError("event_id and token required", 400, requestId, NO_STORE);
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: checkedInAt, error } = await supabaseAdmin.rpc(
    "volunteer_self_checkin_transaction",
    { p_user_id: user.id, p_event_id: eventId, p_token_hash: tokenHash }
  );

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    logError("volunteer_signups.self_checkin_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return jsonError("Check-in link is invalid, expired, or unavailable", status, requestId, NO_STORE);
  }

  return NextResponse.json({ ok: true, checked_in_at: checkedInAt });
}
