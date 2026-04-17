import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (!existingProfile) {
      await supabase.from("profiles").insert({
        id: user.id,
        email: user.email!,
        name: user.user_metadata?.name || user.email!.split("@")[0],
        role: user.user_metadata?.role || "individual",
      });
    }

    const body = await req.json();
    const { event_id } = body;

    const { data, error } = await supabase
      .from("volunteer_signups")
      .insert({ user_id: user.id, event_id })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Already signed up" }, { status: 409 });
      }
      throw error;
    }

    // Increment volunteers_signed_up
    const { data: evt } = await supabase
      .from("volunteer_events")
      .select("volunteers_signed_up")
      .eq("id", event_id)
      .single();

    if (evt) {
      await supabase
        .from("volunteer_events")
        .update({ volunteers_signed_up: (evt.volunteers_signed_up || 0) + 1 })
        .eq("id", event_id);
    }

    return NextResponse.json({ signup: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to sign up";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
