import { NextRequest, NextResponse } from "next/server";
import { normalizeRole } from "@/lib/auth/roles";
import { getLocalNeeds } from "@/lib/local-data";
import { areLocalFixturesEnabled } from "@/lib/env";
import { getRequestId, logError } from "@/lib/observability";
import { DONATION_TYPES } from "@/lib/constants";
import { parseBoundedLimit, parseNeedInput } from "@/lib/validation";
import { projectHiddenLocation } from "@/lib/location-map";

function publicFixtureNeed(need: ReturnType<typeof getLocalNeeds>[number]) {
  const institution = need.institution;
  if (!institution) return need;
  const point = institution.is_location_hidden
    ? projectHiddenLocation(institution.id, institution.lat, institution.lng)
    : { latitude: institution.lat, longitude: institution.lng };
  return {
    ...need,
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
  const { searchParams } = new URL(req.url);
  const requestId = getRequestId(req.headers);
  const donationType = searchParams.get("donation_type");
  const urgency = searchParams.get("urgency");
  const limitResult = parseBoundedLimit(searchParams.get("limit"), 50, 100);
  if (!limitResult.ok) {
    return NextResponse.json({ error: limitResult.error, request_id: requestId }, { status: 400 });
  }
  if (donationType && !(donationType in DONATION_TYPES)) {
    return NextResponse.json({ error: "donation_type is invalid", request_id: requestId }, { status: 400 });
  }
  if (urgency && !["routine", "needed_soon", "urgent"].includes(urgency)) {
    return NextResponse.json({ error: "urgency is invalid", request_id: requestId }, { status: 400 });
  }

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    let query = supabase
      .from("needs")
      .select(
        "*, institution:institutions(id, name, category, address:public_address, city, lat:public_lat, lng:public_lng)"
      )
      .eq("is_fulfilled", false)
      .order("urgency", { ascending: false })
      .order("created_at", { ascending: false });

    if (donationType) query = query.eq("donation_type", donationType);

    if (urgency) query = query.eq("urgency", urgency);

    const institutionId = searchParams.get("institution_id");
    if (institutionId) query = query.eq("institution_id", institutionId);

    query = query.limit(limitResult.value);

    const { data, error } = await query;
    if (error) throw error;
    if (data) {
      return NextResponse.json({ needs: data });
    }
  } catch (error) {
    logError("needs.list_failed", error, { request_id: requestId });
    if (!areLocalFixturesEnabled()) {
      return NextResponse.json(
        { error: "Needs are temporarily unavailable", request_id: requestId },
        { status: 503, headers: { "x-request-id": requestId } }
      );
    }
  }

  let needs = getLocalNeeds();
  if (donationType) needs = needs.filter((n) => n.donation_type === donationType);
  if (urgency) needs = needs.filter((n) => n.urgency === urgency);
  const institutionId = searchParams.get("institution_id");
  if (institutionId) needs = needs.filter((n) => n.institution_id === institutionId);
  needs = needs.slice(0, limitResult.value);

  return NextResponse.json(
    { needs: needs.map(publicFixtureNeed), fixture: true, request_id: requestId },
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

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = parseNeedInput(rawBody);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { title, description, donation_type, urgency, quantity_needed } = parsed.value;

    const { data, error } = await supabase
      .from("needs")
      .insert({
        institution_id: profile.institution_id,
        title,
        description,
        donation_type,
        urgency,
        quantity_needed,
      })
      .select(
        "*, institution:institutions(id, name, category, address:public_address, city, lat:public_lat, lng:public_lng)"
      )
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
          user.id,
          `need:${data.id}`
        );
      }
    }

    return NextResponse.json({ need: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create need";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
