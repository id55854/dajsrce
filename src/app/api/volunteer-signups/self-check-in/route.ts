import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Volunteer marks arrival for an event they signed up for (QR flow). */
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let eventId: string;
  try {
    const body = (await req.json()) as { event_id?: string };
    if (!body.event_id || typeof body.event_id !== "string") {
      throw new Error("bad");
    }
    eventId = body.event_id;
  } catch {
    return NextResponse.json({ error: "event_id required" }, { status: 400 });
  }

  const { data: signup, error: fErr } = await supabase
    .from("volunteer_signups")
    .select("id, checked_in_at, checked_out_at")
    .eq("user_id", user.id)
    .eq("event_id", eventId)
    .maybeSingle();

  if (fErr || !signup) {
    return NextResponse.json({ error: "No signup for this event" }, { status: 404 });
  }
  if (signup.checked_out_at) {
    return NextResponse.json({ error: "Session already completed" }, { status: 409 });
  }
  if (signup.checked_in_at) {
    return NextResponse.json({ ok: true, checked_in_at: signup.checked_in_at, already: true });
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("volunteer_signups").update({ checked_in_at: now }).eq("id", signup.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, checked_in_at: now });
}
