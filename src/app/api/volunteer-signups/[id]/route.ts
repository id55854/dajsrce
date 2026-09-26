import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, isUuid, jsonError, rateLimit, requireSameOrigin, withRequestId } from "@/lib/security/http";
import { hasVolunteerEventEnded } from "@/lib/volunteer-events";

type SignupWithEvent = {
  id: string;
  event: { event_date: string; end_time: string | null } | { event_date: string; end_time: string | null }[] | null;
};

/**
 * The volunteer withdraws from an event that has not ended yet.
 *
 * The row is soft-cancelled, never deleted, and ownership is decided inside
 * the transaction. A signup for an event that is already over stays as it
 * is: it is part of the person's history, and withdrawing after the fact
 * would only tell the organisation something untrue.
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

  // Read under RLS, which shows a person only their own active signups: a
  // row that is not visible here is left to the transaction to refuse.
  const { data: signup, error: readError } = await supabase
    .from("volunteer_signups")
    .select("id, event:volunteer_events(event_date, end_time)")
    .eq("id", signupId)
    .maybeSingle();
  if (readError) {
    logError("volunteer_signups.cancel_read_failed", readError, {
      request_id: requestId,
      code: readError.code ?? null,
    });
    return jsonError("Signup could not be cancelled", 500, requestId, NO_STORE);
  }
  const embedded = (signup as SignupWithEvent | null)?.event;
  const event = Array.isArray(embedded) ? embedded[0] : embedded;
  if (event && hasVolunteerEventEnded(event)) {
    return NextResponse.json(
      {
        error: "The event has ended, so this signup can no longer be withdrawn",
        code: "event_ended",
        request_id: requestId,
      },
      { status: 409, headers: withRequestId(NO_STORE, requestId) }
    );
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
