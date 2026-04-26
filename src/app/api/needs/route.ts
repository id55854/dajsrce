import { NextRequest, NextResponse } from "next/server";
import { normalizeRole } from "@/lib/auth/roles";
import { getLocalNeeds } from "@/lib/local-data";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    let query = supabase
      .from("needs")
      .select("*, institution:institutions(id, name, category, address, city, lat, lng)")
      .eq("is_fulfilled", false)
      .order("urgency", { ascending: false })
      .order("created_at", { ascending: false });

    const donationType = searchParams.get("donation_type");
    if (donationType) query = query.eq("donation_type", donationType);

    const urgency = searchParams.get("urgency");
    if (urgency) query = query.eq("urgency", urgency);

    const institutionId = searchParams.get("institution_id");
    if (institutionId) query = query.eq("institution_id", institutionId);

    const limit = parseInt(searchParams.get("limit") || "50");
    query = query.limit(limit);

    const { data, error } = await query;
    if (error) throw error;
    if (data) {
      return NextResponse.json({ needs: data });
    }
  } catch {
    // Fall back
  }

  let needs = getLocalNeeds();
  const donationType = searchParams.get("donation_type");
  if (donationType) needs = needs.filter((n) => n.donation_type === donationType);
  const urgency = searchParams.get("urgency");
  if (urgency) needs = needs.filter((n) => n.urgency === urgency);
  const institutionId = searchParams.get("institution_id");
  if (institutionId) needs = needs.filter((n) => n.institution_id === institutionId);
  const limit = parseInt(searchParams.get("limit") || "50");
  needs = needs.slice(0, limit);

  return NextResponse.json({ needs });
}

export async function POST(req: NextRequest) {
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("institution_id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr) {
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found. Try signing out and back in." },
        { status: 403 }
      );
    }
    if (normalizeRole(profile.role) !== "ngo") {
      return NextResponse.json({ error: "Only NGOs can post needs" }, { status: 403 });
    }
    if (!profile.institution_id) {
      return NextResponse.json(
        {
          error:
            "Your NGO account is not linked to an institution yet. Finish signup at /auth/setup or contact support.",
        },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { title, description, donation_type, urgency, quantity_needed } = body;

    const { data, error } = await supabase
      .from("needs")
      .insert({
        institution_id: profile.institution_id,
        title,
        description: typeof description === "string" && description.trim() ? description.trim() : null,
        donation_type,
        urgency: urgency || "routine",
        quantity_needed: quantity_needed || null,
      })
      .select("*, institution:institutions(id, name, category, address, city, lat, lng)")
      .single();

    if (error) throw error;

    if (data?.institution) {
      const inst = data.institution as { lat?: number; lng?: number; name?: string };
      if (inst.lat && inst.lng) {
        const { supabaseAdmin } = await import("@/lib/supabase/admin");
        const { notifyNearbyUsers } = await import("@/lib/notify-nearby");
        await notifyNearbyUsers(
          supabaseAdmin,
          inst.lat,
          inst.lng,
          `New need: ${title}`,
          `${inst.name ?? "An NGO"} near you posted a new ${urgency === "urgent" ? "URGENT " : ""}need: "${title}"`,
          `/needs`,
          user.id
        );
      }
    }

    return NextResponse.json({ need: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create need";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
