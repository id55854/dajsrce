import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, jsonError } from "@/lib/security/http";

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("institution_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "ngo" || !profile.institution_id) {
    return jsonError("Institution access required", 403, requestId, NO_STORE);
  }

  const instId = profile.institution_id;

  const { data: events, error: eErr } = await supabase
    .from("volunteer_events")
    .select("id, title, event_date, start_time, end_time")
    .eq("institution_id", instId)
    .order("event_date", { ascending: false })
    .limit(80);

  if (eErr) {
    logError("institution.volunteer_events_failed", eErr, {
      request_id: requestId,
      code: eErr.code ?? null,
    });
    return jsonError("Volunteer events are temporarily unavailable", 500, requestId, NO_STORE);
  }

  const eventIds = (events ?? []).map((e) => e.id);
  if (eventIds.length === 0) {
    return NextResponse.json({ events: [], signups: [] });
  }

  // Cancelled signups are kept as rows (deleting one would cascade away its
  // volunteer-hours evidence), but they are not attendance: an organiser
  // reading this list must not see people who withdrew.
  const { data: signups, error: sErr } = await supabase
    .from("volunteer_signups")
    .select("id, user_id, event_id, checked_in_at, checked_out_at")
    .in("event_id", eventIds)
    .is("cancelled_at", null)
    .order("id", { ascending: false });

  if (sErr) {
    logError("institution.volunteer_signups_failed", sErr, {
      request_id: requestId,
      code: sErr.code ?? null,
    });
    return jsonError("Volunteer signups are temporarily unavailable", 500, requestId, NO_STORE);
  }

  const userIds = Array.from(new Set((signups ?? []).map((s) => s.user_id)));
  const { data: profiles } =
    userIds.length > 0
      ? await supabaseAdmin.from("profiles").select("id, name, email").in("id", userIds)
      : { data: [] };

  const byUser = new Map((profiles ?? []).map((p) => [p.id, p]));

  const enriched = (signups ?? []).map((s) => ({
    ...s,
    volunteer: byUser.get(s.user_id) ?? { id: s.user_id, name: "Volunteer", email: "" },
    event: events?.find((e) => e.id === s.event_id) ?? null,
  }));

  return NextResponse.json({ events: events ?? [], signups: enriched });
}
