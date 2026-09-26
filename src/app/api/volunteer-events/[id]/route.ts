import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, isUuid, jsonError, rateLimit, requireSameOrigin, withRequestId } from "@/lib/security/http";
import { VOLUNTEER_EVENT_FIELDS, parseVolunteerEventPatch } from "@/lib/validation";

type RpcError = { code?: string | null; message?: string | null };

/**
 * A refused edit as the form can explain it. The transaction raises 22023
 * for a value it will not store, 23514 when the new capacity is below the
 * active signups or the event is already over, 42501 for someone else's
 * event and P0002 for a missing one. The raw database message never leaves
 * the server; at most the name of the field it is about does.
 */
function updateRefusal(error: RpcError): { status: number; code?: string; field?: string } {
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "42501") return { status: 403 };
  if (error.code === "P0002") return { status: 404 };
  if (error.code === "22023") {
    const mentioned = VOLUNTEER_EVENT_FIELDS.map((field) => ({ field, at: message.indexOf(field) }))
      .filter(({ at }) => at >= 0)
      .sort((a, b) => a.at - b.at)[0];
    return mentioned ? { status: 400, field: mentioned.field } : { status: 400 };
  }
  if (error.code === "23514") {
    if (/\b(ended|past)\b|already over/.test(message)) return { status: 409, code: "event_ended" };
    if (/signup|signed|capacity|below/.test(message)) return { status: 409, code: "capacity_below_signups" };
    return { status: 409 };
  }
  return { status: 500 };
}

/**
 * The organisation edits one of its own volunteer events: title, text,
 * date, times, place, capacity, requirements and contact. Only the fields
 * being changed are sent. Ownership, the "not below current signups" rule
 * and the notice to signed-up volunteers when the date, time or place moves
 * all live in the transaction; nothing here trusts the request for them.
 */
export async function PATCH(
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
    rateLimit(req, { name: "volunteer_events.patch", limit: 30, windowMs: 60_000 }, requestId);
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
  const parsed = parseVolunteerEventPatch(rawBody);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, field: parsed.field, request_id: requestId },
      { status: 400, headers: withRequestId(NO_STORE, requestId) }
    );
  }

  const { data, error } = await supabaseAdmin.rpc("update_volunteer_event_transaction", {
    p_actor_id: user.id,
    p_event_id: eventId,
    p_patch: parsed.value,
  });

  if (error) {
    const refusal = updateRefusal(error);
    logError("volunteer_events.update_failed", error, { request_id: requestId, code: error.code ?? null });
    return NextResponse.json(
      {
        error: "Event could not be updated",
        ...(refusal.code ? { code: refusal.code } : {}),
        ...(refusal.field ? { field: refusal.field } : {}),
        request_id: requestId,
      },
      { status: refusal.status, headers: withRequestId(NO_STORE, requestId) }
    );
  }

  return NextResponse.json(
    { event: data, request_id: requestId },
    { headers: withRequestId(NO_STORE, requestId) }
  );
}

/**
 * The organisation deletes (cancels) one of its own volunteer events.
 *
 * Signups under it cascade away, so the transaction first notifies every
 * volunteer still signed up and audits the counts. Ownership is decided inside
 * the transaction from the actor's profile, never from the request.
 */
export async function DELETE(
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
    rateLimit(req, { name: "volunteer_events.delete", limit: 30, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  const { data, error } = await supabaseAdmin.rpc("delete_volunteer_event_transaction", {
    p_actor_id: user.id,
    p_event_id: eventId,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    logError("volunteer_events.delete_failed", error, { request_id: requestId, code: error.code ?? null });
    return jsonError("Event could not be deleted", status, requestId, NO_STORE);
  }

  return NextResponse.json({ ok: true, deleted: data }, { headers: NO_STORE });
}
