import { NextRequest, NextResponse } from "next/server";
import { normalizeRole } from "@/lib/auth/roles";
import { getLocalVolunteerEvents } from "@/lib/local-data";
import { areLocalFixturesEnabled } from "@/lib/env";
import { getRequestId, logError } from "@/lib/observability";
import { parseVolunteerEventInput } from "@/lib/validation";
import { projectHiddenLocation } from "@/lib/location-map";

function publicFixtureEvent(event: ReturnType<typeof getLocalVolunteerEvents>[number]) {
  const institution = event.institution;
  if (!institution) return event;
  const point = institution.is_location_hidden
    ? projectHiddenLocation(institution.id, institution.lat, institution.lng)
    : { latitude: institution.lat, longitude: institution.lng };
  return {
    ...event,
    institution: {
      id: institution.id,
      name: institution.name,
      category: institution.category,
      address: institution.is_location_hidden
        ? institution.approximate_area ?? institution.city
        : institution.address,
      city: institution.city,
      lat: point.latitude,
      lng: point.longitude,
      is_location_hidden: institution.is_location_hidden,
      approximate_area: institution.approximate_area,
    },
  };
}

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase
      .from("volunteer_events")
      .select("*, institution:institutions(id, name, category, address:public_address, city)")
      .gte("event_date", new Date().toISOString().split("T")[0])
      .order("event_date", { ascending: true })
      .limit(30);

    if (error) throw error;
    if (data) {
      return NextResponse.json({ events: data });
    }
  } catch (error) {
    logError("volunteer_events.list_failed", error, { request_id: requestId });
    if (!areLocalFixturesEnabled()) {
      return NextResponse.json(
        { error: "Volunteer events are temporarily unavailable", request_id: requestId },
        { status: 503, headers: { "x-request-id": requestId } }
      );
    }
  }

  return NextResponse.json(
    {
      events: getLocalVolunteerEvents().map(publicFixtureEvent),
      fixture: true,
      request_id: requestId,
    },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } }
  );
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

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = parseVolunteerEventInput(rawBody);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { title, description, event_date, start_time, end_time, volunteers_needed, requirements } = parsed.value;

    const { data, error } = await supabase
      .from("volunteer_events")
      .insert({
        institution_id: profile.institution_id,
        title,
        description,
        event_date,
        start_time,
        end_time,
        volunteers_needed,
        requirements,
      })
      .select(
        "*, institution:institutions(id, name, category, address:public_address, city, lat:public_lat, lng:public_lng)"
      )
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
          user.id,
          `volunteer-event:${data.id}`
        );
      }
    }

    return NextResponse.json({ event: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create event";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
