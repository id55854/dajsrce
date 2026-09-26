import { NextRequest, NextResponse } from "next/server";
import { normalizeRole } from "@/lib/auth/roles";
import { getLocalNeeds } from "@/lib/local-data";
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
import { CATEGORY_CONFIG, DONATION_TYPES } from "@/lib/constants";
import { parseBoundedLimit, parseNeedInput } from "@/lib/validation";
import { isOpenForNewNeeds, needFieldFromMessage } from "@/lib/need-patch";
import { displayOrganisationName } from "@/lib/display-name";
import { needPermalink } from "@/lib/pledge-flow";
import { projectHiddenLocation } from "@/lib/location-map";
import { publicListResponse } from "@/lib/public-list-response";
import { createPublicSupabaseClient } from "@/lib/supabase/public";

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
  const startedAt = performance.now();
  const { searchParams } = new URL(req.url);
  const requestId = getRequestId(req.headers);
  const donationType = searchParams.get("donation_type");
  const urgency = searchParams.get("urgency");
  const categories = [...new Set((searchParams.get("categories") ?? "").split(",").filter(Boolean))];
  if (categories.some((category) => !Object.hasOwn(CATEGORY_CONFIG, category))) {
    return NextResponse.json({ error: "categories is invalid", request_id: requestId }, { status: 400 });
  }
  const institutionId = searchParams.get("institution_id");
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
  if (institutionId && !isUuid(institutionId)) {
    return NextResponse.json({ error: "institution_id is invalid", request_id: requestId }, { status: 400 });
  }

  const blocked = rateLimit(req, { name: "needs.get", limit: 120, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  // Explicit local demo mode must never wait for a failed database request.
  if (areLocalFixturesEnabled()) {
    let needs = getLocalNeeds();
    if (categories.length) needs = needs.filter((need) => need.institution && categories.includes(need.institution.category));
    if (donationType) needs = needs.filter((n) => n.donation_type === donationType);
    if (urgency) needs = needs.filter((n) => n.urgency === urgency);
    if (institutionId) needs = needs.filter((n) => n.institution_id === institutionId);
    needs = needs.slice(0, limitResult.value);

    return NextResponse.json(
      { needs: needs.map(publicFixtureNeed), fixture: true, request_id: requestId },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } }
    );
  }

  try {
    // The open-needs list is the same for every visitor (RLS: needs are
    // viewable by everyone, institutions expose only their public projection
    // columns). Reading it through the stateless anon client keeps cookies out
    // of the request, which is what lets the CDN hold one copy for everyone
    // instead of one round trip to Postgres per visitor.
    const supabase = createPublicSupabaseClient();

    let query = supabase
      .from("needs")
      .select(
        `id,institution_id,title,description,donation_type,urgency,quantity_needed,quantity_pledged,quantity_delivered,photo_url,deadline,is_fulfilled,created_at, institution:institutions${categories.length ? "!inner" : ""}(id, name, category, address:public_address, city, lat:public_lat, lng:public_lng)`
      )
      .eq("is_fulfilled", false)
      .order("urgency", { ascending: false })
      .order("created_at", { ascending: false });

    if (categories.length) query = query.in("institution.category", categories);

    if (donationType) query = query.eq("donation_type", donationType);

    if (urgency) query = query.eq("urgency", urgency);

    if (institutionId) query = query.eq("institution_id", institutionId);

    query = query.limit(limitResult.value);

    const queryStartedAt = performance.now();
    const { data, error } = await query;
    const queryMs = performance.now() - queryStartedAt;
    if (error) throw error;
    if (data) {
      return publicListResponse(req, { needs: data }, requestId, {
        queryMs, totalMs: performance.now() - startedAt,
      });
    }
  } catch (error) {
    logError("needs.list_failed", error, { request_id: requestId });
  }

  return NextResponse.json(
    { error: "Needs are temporarily unavailable", request_id: requestId },
    { status: 503, headers: { "x-request-id": requestId } }
  );
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "needs.post", limit: 20, windowMs: 60_000 }, requestId);
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
      logError("needs.profile_read_failed", profileErr, {
        request_id: requestId,
        code: profileErr.code ?? null,
      });
      return jsonError("Profile is temporarily unavailable", 500, requestId, NO_STORE);
    }
    if (!profile) {
      return jsonError("Profile setup is incomplete", 403, requestId, NO_STORE);
    }
    if (normalizeRole(profile.role) !== "ngo") {
      return jsonError("Only NGOs can post needs", 403, requestId, NO_STORE);
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
    const parsed = parseNeedInput(rawBody);
    if (!parsed.ok) {
      // The field lets the form say what is wrong in Croatian; the message
      // itself is internal.
      const field = needFieldFromMessage(parsed.error);
      return NextResponse.json(
        { error: parsed.error, ...(field ? { field } : {}), request_id: requestId },
        { status: 400, headers: withRequestId(NO_STORE, requestId) }
      );
    }
    const { title, description, donation_type, urgency, quantity_needed, deadline } = parsed.value;

    // Collecting money for people in need requires permanent-collector
    // status or an approved humanitarian action (NN 156/23), which DajSrce
    // does not check yet, so no new need may ask for money. The message is
    // Croatian because an older, cached form shows it as it is.
    if (!isOpenForNewNeeds(donation_type)) {
      return NextResponse.json(
        {
          error: "Novčane donacije zasad se ne mogu objaviti kao potreba. Odaberite drugu vrstu donacije.",
          code: "donation_type_unavailable",
          field: "donation_type",
          request_id: requestId,
        },
        { status: 400, headers: withRequestId(NO_STORE, requestId) }
      );
    }

    const { data, error } = await supabase
      .from("needs")
      .insert({
        institution_id: profile.institution_id,
        title,
        description,
        donation_type,
        urgency,
        quantity_needed,
        deadline,
      })
      .select(
        "id,institution_id,title,description,donation_type,urgency,quantity_needed,quantity_pledged,quantity_delivered,photo_url,deadline,is_fulfilled,created_at,institution:institutions(id, name, category, address:public_address, city, lat:public_lat, lng:public_lng)"
      )
      .single();

    if (error?.code === "42501") {
      // The owner-scoped insert policy refused: not this organisation's to post.
      logError("needs.create_refused", error, { request_id: requestId, code: error.code });
      return jsonError("Institution access required", 403, requestId, NO_STORE);
    }
    if (error) throw error;

    if (data?.institution) {
      const inst = data.institution as { lat?: number; lng?: number; name?: string };
      if (inst.lat && inst.lng) {
        // Opted-in donors nearby, through the durable outbox. The text is
        // Croatian like every other notice, the register's capitals are
        // toned down, and the link opens this need on the giving page.
        const organisation = displayOrganisationName(inst.name) || "Udruga";
        try {
          const { supabaseAdmin } = await import("@/lib/supabase/admin");
          const { notifyNearbyUsers } = await import("@/lib/notify-nearby");
          await notifyNearbyUsers(
            supabaseAdmin,
            inst.lat,
            inst.lng,
            `${urgency === "urgent" ? "Hitna potreba" : "Nova potreba"}: ${title}`,
            `${organisation} u vašoj blizini treba: ${title}`,
            needPermalink(data.id),
            user.id,
            `need:${data.id}`
          );
        } catch (notifyError) {
          // The need is already published. Reporting the post as failed
          // would only invite a duplicate; the notice is what is lost.
          logError("needs.notify_enqueue_failed", notifyError, { request_id: requestId });
        }
      }
    }

    return NextResponse.json(
      { need: data, request_id: requestId },
      { headers: withRequestId(NO_STORE, requestId) }
    );
  } catch (e) {
    logError("needs.create_failed", e, { request_id: requestId });
    return jsonError("Failed to create need", 500, requestId, NO_STORE);
  }
}
