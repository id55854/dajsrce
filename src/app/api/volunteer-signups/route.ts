import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ signups: [] });
    }

    const { data, error } = await supabase
      .from("volunteer_signups")
      .select("event_id, checked_in_at, checked_out_at")
      .eq("user_id", user.id);

    if (error) throw error;
    return NextResponse.json({ signups: data ?? [] });
  } catch {
    return NextResponse.json({ signups: [] });
  }
}

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
      return NextResponse.json({ error: "Profile setup is incomplete" }, { status: 409 });
    }

    const body = (await req.json()) as { event_id?: unknown };
    const { event_id } = body;
    if (typeof event_id !== "string" || !event_id) {
      return NextResponse.json({ error: "event_id is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc("volunteer_signup_transaction", {
      p_user_id: user.id,
      p_event_id: event_id,
    });

    if (error) {
      const status = error.code === "P0002" ? 404 : 409;
      return NextResponse.json({ error: "Could not sign up for this event" }, { status });
    }

    return NextResponse.json({ signup: data }, { status: 201 });
  } catch (e) {
    console.error("[/api/volunteer-signups POST] failed", e);
    return NextResponse.json({ error: "Failed to sign up" }, { status: 500 });
  }
}
