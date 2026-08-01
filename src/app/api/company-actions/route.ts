import { NextResponse } from "next/server";
import { normalizeRole } from "@/lib/auth/roles";

export async function GET() {
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ actions: [] });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (normalizeRole(profile?.role) !== "company") {
      return NextResponse.json({ actions: [] });
    }

    const { data, error } = await supabase
      .from("company_actions")
      .select("*")
      .eq("company_profile_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ actions: data ?? [] });
  } catch {
    return NextResponse.json({ actions: [] });
  }
}

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Legacy self-attested company actions are read-only. Use the pledge and NGO acknowledgement workflow.",
    },
    { status: 410 }
  );
}
