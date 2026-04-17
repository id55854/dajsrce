import { NextRequest, NextResponse } from "next/server";
import { normalizeRole } from "@/lib/auth/roles";

function makeSlug() {
  return `conf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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

export async function POST(req: NextRequest) {
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, name")
      .eq("id", user.id)
      .maybeSingle();
    if (normalizeRole(profile?.role) !== "company") {
      return NextResponse.json(
        { error: "Only company users can create corporate actions" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const payload = {
      company_profile_id: user.id,
      company_name: profile?.name ?? "Company",
      ngo_name: body.ngo_name,
      support_type: body.support_type,
      status: "confirmed",
      note: body.note || null,
      confirmation_slug: makeSlug(),
      shipment_method: body.shipment_method || "courier_pickup",
    };

    const { data, error } = await supabase
      .from("company_actions")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ action: data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create company action";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
