import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("institution_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "ngo" || !profile.institution_id) {
    return NextResponse.json({ error: "Institution access required" }, { status: 403 });
  }

  const instId = profile.institution_id;

  const { data: events, error: eErr } = await supabase
    .from("volunteer_events")
    .select("id, title, event_date, start_time, end_time")
    .eq("institution_id", instId)
    .order("event_date", { ascending: false })
    .limit(80);

  if (eErr) {
    return NextResponse.json({ error: eErr.message }, { status: 500 });
  }

  const eventIds = (events ?? []).map((e) => e.id);
  if (eventIds.length === 0) {
    return NextResponse.json({ events: [], signups: [] });
  }

  const { data: signups, error: sErr } = await supabase
    .from("volunteer_signups")
    .select("id, user_id, event_id, checked_in_at, checked_out_at, company_id")
    .in("event_id", eventIds)
    .order("id", { ascending: false });

  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  const userIds = Array.from(new Set((signups ?? []).map((s) => s.user_id)));
  const { data: profiles } =
    userIds.length > 0
      ? await supabase.from("profiles").select("id, name, email").in("id", userIds)
      : { data: [] };

  const byUser = new Map((profiles ?? []).map((p) => [p.id, p]));

  const enriched = (signups ?? []).map((s) => ({
    ...s,
    volunteer: byUser.get(s.user_id) ?? { id: s.user_id, name: "Volunteer", email: "" },
    event: events?.find((e) => e.id === s.event_id) ?? null,
  }));

  return NextResponse.json({ events: events ?? [], signups: enriched });
}
