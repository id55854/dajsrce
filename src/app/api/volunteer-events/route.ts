import { NextRequest, NextResponse } from "next/server";
import { normalizeRole } from "@/lib/auth/roles";
import { getLocalVolunteerEvents } from "@/lib/local-data";
import { areLocalFixturesEnabled } from "@/lib/env";
import { getRequestId, logError } from "@/lib/observability";
import {
  NO_STORE,
  isUuid,
  jsonError,
  rateLimit,
  requireSameOrigin,
  withRequestId,
} from "@/lib/security/http";
import { parseVolunteerEventInput } from "@/lib/validation";
import { projectHiddenLocation } from "@/lib/location-map";
import { publicListResponse } from "@/lib/public-list-response";
import { createPublicSupabaseClient } from "@/lib/supabase/public";

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
  // One organisation's upcoming events, for the map's detail panel. Same
  // shape and same public projection as the full list; the filter only
  // narrows what a visitor could already read.
  const institutionId = new URL(req.url).searchParams.get("institution_id");
  if (institutionId && !isUuid(institutionId)) {
    return NextResponse.json(
      { error: "institution_id is invalid", request_id: requestId },
      { status: 400, headers: { "x-request-id": requestId } }
    );
  }
  const blocked = rateLimit(req, { name: "volunteer_events.get", limit: 120, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  try {
    // Public list, identical for every visitor: read it through the
    // stateless anon client so the CDN can cache it (see /api/needs).
    const supabase = createPublicSupabaseClient();

    let query = supabase
      .from("volunteer_events")
      .select("*, institution:institutions(id, name, category, address:public_address, city)")
      .gte("event_date", new Date().toISOString().split("T")[0])
      .order("event_date", { ascending: true })
      .limit(30);

    if (institutionId) query = query.eq("institution_id", institutionId);

    const { data, error } = await query;

    if (error) throw error;
    if (data) {
      return publicListResponse(req, { events: data }, requestId);
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

  const fixtures = getLocalVolunteerEvents().filter(
    (event) => !institutionId || event.institution_id === institutionId
  );
  return NextResponse.json(
    {
      events: fixtures.map(publicFixtureEvent),
      fixture: true,
      request_id: requestId,
    },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } }
  );
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "volunteer_events.post", limit: 20, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return jsonError("Not authenticated", 401, requestId, NO_STORE);
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("institution_id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr) {
      logError("volunteer_events.profile_read_failed", profileErr, {
        request_id: requestId,
        code: profileErr.code ?? null,
      });
      return jsonError("Profile is temporarily unavailable", 500, requestId, NO_STORE);
    }
    if (!profile) {
      return jsonError("Profile setup is incomplete", 403, requestId, NO_STORE);
    }
    if (normalizeRole(profile.role) !== "ngo") {
      return jsonError("Only NGOs can create events", 403, requestId, NO_STORE);
    }
    if (!profile.institution_id) {
      return jsonError("Institution setup is incomplete", 403, requestId, NO_STORE);
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return jsonError("Invalid JSON", 400, requestId, NO_STORE);
    }
    const parsed = parseVolunteerEventInput(rawBody);
    if (!parsed.ok) return jsonError(parsed.error, 400, requestId, NO_STORE);
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

    return NextResponse.json(
      { event: data, request_id: requestId },
      { headers: withRequestId(NO_STORE, requestId) }
    );
  } catch (e) {
    logError("volunteer_events.create_failed", e, { request_id: requestId });
    return jsonError("Failed to create event", 500, requestId, NO_STORE);
  }
}
