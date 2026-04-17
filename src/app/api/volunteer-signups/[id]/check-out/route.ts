import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function requireNgoOwnsSignup(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  signupId: string
): Promise<
  | {
      ok: true;
      signup: {
        id: string;
        user_id: string;
        event_id: string;
        company_id: string | null;
        checked_in_at: string | null;
        checked_out_at: string | null;
      };
      institutionId: string;
    }
  | { ok: false; status: number; error: string }
> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("institution_id, role")
    .eq("id", userId)
    .maybeSingle();

  if (!profile || profile.role !== "ngo" || !profile.institution_id) {
    return { ok: false, status: 403, error: "Institution access required" };
  }

  const { data: signup, error: sErr } = await supabase
    .from("volunteer_signups")
    .select("id, user_id, event_id, company_id, checked_in_at, checked_out_at")
    .eq("id", signupId)
    .maybeSingle();

  if (sErr || !signup) {
    return { ok: false, status: 404, error: "Signup not found" };
  }

  const { data: event } = await supabase
    .from("volunteer_events")
    .select("institution_id")
    .eq("id", signup.event_id)
    .maybeSingle();

  if (!event || event.institution_id !== profile.institution_id) {
    return { ok: false, status: 403, error: "Not your institution's event" };
  }

  return { ok: true, signup, institutionId: event.institution_id };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: signupId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const gate = await requireNgoOwnsSignup(supabase, user.id, signupId);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { signup, institutionId } = gate;
  if (!signup.checked_in_at) {
    return NextResponse.json({ error: "Check in first" }, { status: 400 });
  }
  if (signup.checked_out_at) {
    return NextResponse.json({ error: "Already checked out" }, { status: 409 });
  }

  const inMs = new Date(signup.checked_in_at).getTime();
  const outMs = Date.now();
  let hours = (outMs - inMs) / (1000 * 60 * 60);
  hours = Math.min(Math.max(hours, 0.01), 36);
  hours = Math.round(hours * 100) / 100;

  const checkedOutAt = new Date().toISOString();

  const { error: upErr } = await supabase
    .from("volunteer_signups")
    .update({ checked_out_at: checkedOutAt })
    .eq("id", signupId);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const { error: insErr } = await supabaseAdmin.from("volunteer_hours").insert({
    volunteer_signup_id: signupId,
    user_id: signup.user_id,
    institution_id: institutionId,
    company_id: signup.company_id,
    hours,
    recorded_by: user.id,
    recorded_at: checkedOutAt,
  });

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, checked_out_at: checkedOutAt, hours });
}
