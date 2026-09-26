import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getVerifiedClaims } from "@/lib/auth/claims";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, isUuid, jsonError, rateLimit, requireSameOrigin, withRequestId } from "@/lib/security/http";
import { capacityErrorCode } from "@/lib/capacity-errors";
import { emailAppOrigin, sendVolunteerEmail } from "@/lib/email/volunteer-emails";
import { hasVolunteerEventEnded } from "@/lib/volunteer-events";

/**
 * What the signup needs to know about the event before the transaction, and
 * what the confirmation e-mail states. The institution comes through its
 * public projection, so a hidden location stays coarse in the e-mail too.
 */
const EVENT_COLUMNS =
  "id, title, event_date, start_time, end_time, location, requirements, contact_person, contact_phone, institution:institutions(name, address:public_address, city)";

type SignupEvent = {
  id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  requirements: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  institution:
    | { name?: string | null; address?: string | null; city?: string | null }
    | { name?: string | null; address?: string | null; city?: string | null }[]
    | null;
};

function refusal(code: string, status: number, requestId: string) {
  return NextResponse.json(
    { error: "Could not sign up for this event", code, request_id: requestId },
    { status, headers: withRequestId(NO_STORE, requestId) }
  );
}

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked = rateLimit(req, { name: "volunteer_signups.get", limit: 60, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    // Read path: the JWT is verified locally; RLS scopes the rows to the user.
    const user = await getVerifiedClaims(supabase);
    if (!user) {
      return NextResponse.json({ signups: [] }, { headers: NO_STORE });
    }

    // Which events this person is already signed up for, and the signup id
    // their own withdraw control needs: a signup has no state beyond existing.
    const { data, error } = await supabase
      .from("volunteer_signups")
      .select("id, event_id")
      .eq("user_id", user.id)
      .is("cancelled_at", null);

    if (error) throw error;
    return NextResponse.json({ signups: data ?? [] });
  } catch {
    return NextResponse.json({ signups: [] });
  }
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "volunteer_signups.post", limit: 30, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return jsonError("Not authenticated", 401, requestId, NO_STORE);
    }

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id, name")
      .eq("id", user.id)
      .maybeSingle();

    if (!existingProfile) {
      return jsonError("Profile setup is incomplete", 409, requestId, NO_STORE);
    }

    let body: { event_id?: unknown; age_confirmed?: unknown };
    try {
      body = (await req.json()) as { event_id?: unknown; age_confirmed?: unknown };
    } catch {
      return jsonError("Invalid JSON", 400, requestId, NO_STORE);
    }
    const { event_id } = body;
    if (!isUuid(event_id)) {
      return jsonError("event_id is invalid", 400, requestId, NO_STORE);
    }
    // Volunteers aged 15 to 17 need a parent's or guardian's written consent,
    // so every signup carries the volunteer's own explicit confirmation. Only
    // a literal `true` counts.
    if (body.age_confirmed !== true) {
      return refusal("age_confirmation_required", 400, requestId);
    }

    // Events are public, so the caller's own client reads it. The date-level
    // "has ended" rule is also the transaction's; the end time on the day
    // itself is checked here.
    const { data: eventRow, error: eventError } = await supabase
      .from("volunteer_events")
      .select(EVENT_COLUMNS)
      .eq("id", event_id)
      .maybeSingle();
    if (eventError) {
      logError("volunteer_signups.event_read_failed", eventError, {
        request_id: requestId,
        code: eventError.code ?? null,
      });
      return jsonError("Failed to sign up", 500, requestId, NO_STORE);
    }
    const event = eventRow as SignupEvent | null;
    if (!event) {
      return jsonError("Event not found", 404, requestId, NO_STORE);
    }
    if (hasVolunteerEventEnded(event)) {
      return refusal("event_ended", 409, requestId);
    }

    const { data, error } = await supabaseAdmin.rpc("volunteer_signup_transaction", {
      p_user_id: user.id,
      p_event_id: event_id,
    });

    if (error) {
      const status = error.code === "P0002" ? 404 : 409;
      logError("volunteer_signups.create_transaction_failed", error, {
        request_id: requestId,
        code: error.code ?? null,
      });
      // The card needs to tell "already yours" from "full" from "over".
      const code = capacityErrorCode(error);
      if (code) return refusal(code, status, requestId);
      return jsonError("Could not sign up for this event", status, requestId, NO_STORE);
    }

    // The confirmation goes out after the response, so a slow or failing
    // mail provider can never cost the volunteer their place or their answer.
    const institution = Array.isArray(event.institution) ? event.institution[0] : event.institution;
    const appOrigin = emailAppOrigin(req.nextUrl.origin);
    const confirm = () =>
      sendVolunteerEmail(
        "signup",
        {
          to: user.email,
          recipientName: (existingProfile as { name?: string | null }).name ?? null,
          appOrigin,
          event: {
            id: event.id,
            title: event.title,
            event_date: event.event_date,
            start_time: event.start_time,
            end_time: event.end_time,
            location: event.location,
            requirements: event.requirements,
            contact_person: event.contact_person,
            contact_phone: event.contact_phone,
            institution_name: institution?.name ?? null,
            institution_address: institution?.address ?? null,
            institution_city: institution?.city ?? null,
          },
        },
        { requestId }
      );
    try {
      after(confirm);
    } catch {
      // Outside a request scope `after` throws; the signup already stands.
      void confirm();
    }

    return NextResponse.json({ signup: data }, { status: 201 });
  } catch (error) {
    logError("volunteer_signups.create_failed", error, { request_id: requestId });
    return jsonError("Failed to sign up", 500, requestId, NO_STORE);
  }
}
