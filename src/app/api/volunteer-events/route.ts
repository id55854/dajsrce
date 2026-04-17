import { NextRequest, NextResponse } from "next/server";
import { normalizeRole } from "@/lib/auth/roles";
import { getLocalVolunteerEvents } from "@/lib/local-data";

export async function GET(_req: NextRequest) {
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase
      .from("volunteer_events")
      .select("*, institution:institutions(id, name, category, address, city)")
      .gte("event_date", new Date().toISOString().split("T")[0])
      .order("event_date", { ascending: true })
      .limit(30);

    if (error) throw error;
    if (data) {
      return NextResponse.json({ events: data });
    }
  } catch {
    // Fall back
  }

  return NextResponse.json({ events: getLocalVolunteerEvents() });
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
      return NextResponse.json({ error: "Only NGOs can create events" }, { status: 403 });
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
    const { title, description, event_date, start_time, end_time, volunteers_needed, requirements } = body;

    const { data, error } = await supabase
      .from("volunteer_events")
      .insert({
        institution_id: profile.institution_id,
        title,
        description,
        event_date,
        start_time,
        end_time,
        volunteers_needed: volunteers_needed || 5,
        requirements: requirements || null,
      })
      .select("*, institution:institutions(id, name, category, address, city, lat, lng)")
      .single();

    if (error) throw error;

    if (data?.institution) {
      const inst = data.institution as { lat?: number; lng?: number; name?: string; address?: string; city?: string };
      if (inst.lat && inst.lng) {
        const { supabaseAdmin } = await import("@/lib/supabase/admin");
        const { notifyNearbyUsers } = await import("@/lib/notify-nearby");
        await notifyNearbyUsers(
          supabaseAdmin,
          inst.lat,
          inst.lng,
          `Volunteer event: ${title}`,
          `${inst.name ?? "An NGO"} near you needs volunteers for "${title}" on ${event_date}`,
          `/volunteer`,
          user.id
        );
      }
    }

    return NextResponse.json({ event: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create event";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
