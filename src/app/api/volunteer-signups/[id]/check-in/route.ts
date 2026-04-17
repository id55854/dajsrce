import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function requireNgoOwnsSignup(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  signupId: string
): Promise<
  | { ok: true; signup: { id: string; event_id: string; checked_in_at: string | null; checked_out_at: string | null } }
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
    .select("id, event_id, checked_in_at, checked_out_at")
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

  return { ok: true, signup };
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

  const { signup } = gate;
  if (signup.checked_out_at) {
    return NextResponse.json({ error: "Session already completed" }, { status: 409 });
  }
  if (signup.checked_in_at) {
    return NextResponse.json({ error: "Already checked in" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("volunteer_signups").update({ checked_in_at: now }).eq("id", signupId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, checked_in_at: now });
}
