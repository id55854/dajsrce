import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getVerifiedClaims } from "@/lib/auth/claims";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, jsonError, rateLimit } from "@/lib/security/http";
import { institutionCalendarEntries } from "@/lib/profile-calendar";

const LIMIT = 100;

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked = rateLimit(req, { name: "institution.calendar.get", limit: 60, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;
  try {
    const supabase = await createServerSupabaseClient();
    const user = await getVerifiedClaims(supabase);
    if (!user) return jsonError("Not authenticated", 401, requestId, NO_STORE);
    const { data: profile, error: profileError } = await supabase.from("profiles").select("institution_id, role").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.role !== "ngo" || !profile.institution_id) return jsonError("Institution access required", 403, requestId, NO_STORE);
    // Both explicit ownership and RLS scope this private profile calendar.
    const [needs, events] = await Promise.all([
      supabase.from("needs").select("id, title, description, deadline, is_fulfilled, quantity_needed, quantity_pledged, created_at").eq("institution_id", profile.institution_id).order("created_at", { ascending: false }).limit(LIMIT + 1),
      supabase.from("volunteer_events").select("id, title, description, event_date, start_time, end_time, requirements, volunteers_needed, volunteers_signed_up, created_at").eq("institution_id", profile.institution_id).order("created_at", { ascending: false }).limit(LIMIT + 1),
    ]);
    if (needs.error) throw needs.error;
    if (events.error) throw events.error;
    return NextResponse.json({
      entries: institutionCalendarEntries((needs.data ?? []).slice(0, LIMIT), (events.data ?? []).slice(0, LIMIT)),
      truncated: (needs.data?.length ?? 0) > LIMIT || (events.data?.length ?? 0) > LIMIT,
    }, { headers: NO_STORE });
  } catch (error) {
    logError("institution.calendar_failed", error, { request_id: requestId });
    return jsonError("Calendar is temporarily unavailable", 500, requestId, NO_STORE);
  }
}
