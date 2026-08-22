import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  MAP_API_VERSION,
  MapQueryValidationError,
  parseMapQuery,
  trustStatus,
  type MapPlaceKind,
  type MapQuery,
  type PublicMapFeature,
  type PublicMapInstitution,
  type PublicMapResponse,
} from "@/lib/location-map";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import type { DonationType, InstitutionCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

const PUBLIC_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

type RpcMapRow = {
  feature_kind: "cluster" | "institution";
  feature_id: string;
  institution_id: string | null;
  registry_id: string | null;
  entity_type: "institution" | "registry" | null;
  name: string | null;
  category: string | null;
  city: string | null;
  address: string | null;
  approximate_area: string | null;
  location_precision: "exact" | "hidden" | "city" | "county" | null;
  latitude: number;
  longitude: number;
  accepts_donations: string[] | null;
  is_verified: boolean;
  is_location_hidden: boolean;
  source: string | null;
  has_urgent_need: boolean;
  member_count: number;
  min_lng: number;
  min_lat: number;
  max_lng: number;
  max_lat: number;
  total_matches: number;
  total_features: number;
  place_kind: MapPlaceKind | null;
  place_name: string | null;
};

type FallbackInstitutionRow = {
  id: string;
  name: string;
  category: InstitutionCategory;
  city: string | null;
  approximate_area: string | null;
  public_lat: number;
  public_lng: number;
  accepts_donations: DonationType[] | null;
  is_verified: boolean | null;
  is_location_hidden: boolean | null;
  source: string | null;
};

function isMissingRpc(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /map_association_registry_v[12]|could not find the function/i.test(error.message ?? "")
  );
}

function rpcRowToFeature(row: RpcMapRow): PublicMapFeature | null {
  if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) {
    return null;
  }

  if (row.feature_kind === "cluster") {
    // A deployed-but-older function has no place columns. Falling back to the
    // spatial kind keeps such a response renderable rather than showing a
    // cluster labelled "undefined".
    const placeKind = row.place_kind ?? "grid";
    return {
      kind: "cluster",
      id: row.feature_id,
      latitude: row.latitude,
      longitude: row.longitude,
      count: Number(row.member_count),
      bounds: [row.min_lng, row.min_lat, row.max_lng, row.max_lat],
      hasUrgentNeed: Boolean(row.has_urgent_need),
      placeKind,
      placeName: placeKind === "grid" ? null : row.place_name,
    };
  }

  if (!row.name || !row.category || !row.entity_type) return null;
  return {
    kind: "institution",
    id: row.feature_id,
    entityType: row.entity_type,
    registryId: row.registry_id,
    name: row.name,
    category: row.category as InstitutionCategory,
    city: row.city,
    address: row.address,
    approximateArea: row.approximate_area,
    latitude: row.latitude,
    longitude: row.longitude,
    acceptsDonations: (row.accepts_donations ?? []) as DonationType[],
    isVerified: Boolean(row.is_verified),
    isLocationHidden: Boolean(row.is_location_hidden),
    locationPrecision: row.location_precision ?? (row.is_location_hidden ? "hidden" : "exact"),
    trustStatus: trustStatus(Boolean(row.is_verified), row.source),
    hasUrgentNeed: Boolean(row.has_urgent_need),
  };
}

async function queryIndexedRpc(query: MapQuery) {
  const supabase = createPublicSupabaseClient();
  const [minLng, minLat, maxLng, maxLat] = query.bbox;
  const parameters = {
    p_min_lng: minLng,
    p_min_lat: minLat,
    p_max_lng: maxLng,
    p_max_lat: maxLat,
    p_zoom: query.zoom,
    p_categories: query.categories,
    p_donation_type: query.donationType,
    p_only_zagreb: query.onlyZagreb,
    p_only_urgent: query.onlyUrgent,
    p_query: query.query,
    p_limit: query.limit,
    ...(query.city ? { p_city: query.city } : {}),
    // Sent only when set. The argument is newer than the deployed functions
    // may be, and omitting it keeps an older signature resolvable; including
    // it when it is genuinely required means a stale schema fails the request
    // instead of quietly returning register rows the caller excluded.
    ...(query.onlyOnboarded ? { p_only_onboarded: true } : {}),
  };

  let { data, error } = await supabase.rpc("map_association_registry_v2", parameters);

  // Rolling deployments may briefly have the application or migration ahead
  // of the other. v1 preserves complete map coverage until v2 is available;
  // only the exact registry street-address enrichment is absent in that gap.
  if (error && isMissingRpc(error)) {
    ({ data, error } = await supabase.rpc("map_association_registry_v1", parameters));
  }

  if (error) {
    if (isMissingRpc(error)) return null;
    throw new Error(`Map query failed (${error.code ?? "database"})`);
  }

  const rows = (data ?? []) as RpcMapRow[];
  const features = rows
    .slice(0, query.limit)
    .map(rpcRowToFeature)
    .filter((feature): feature is PublicMapFeature => feature != null);
  const first = rows[0];
  const totalMatches = Number(first?.total_matches ?? 0);
  const totalFeatures = Number(first?.total_features ?? 0);

  return {
    features,
    totalMatches,
    totalFeatures,
    truncated: rows.length > features.length || totalFeatures > features.length,
    mode: (rows[0]?.feature_kind === "cluster"
      ? "clusters"
      : "institutions") as "clusters" | "institutions",
    strategy: "postgis-rpc",
  };
}

function safeFallbackSearch(query: string): string {
  return query.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
}

async function queryBoundedFallback(query: MapQuery) {
  const supabase = createPublicSupabaseClient();
  const [minLng, minLat, maxLng, maxLat] = query.bbox;
  let urgentIds: string[] | null = null;
  let urgentIdsTruncated = false;

  if (query.onlyUrgent) {
    const { data: needs, error: needsError } = await supabase
      .from("needs")
      .select("institution_id")
      .eq("urgency", "urgent")
      .eq("is_fulfilled", false)
      .limit(501);
    if (needsError) throw new Error(`Urgent-needs query failed (${needsError.code})`);
    const allIds = [...new Set((needs ?? []).map((row) => row.institution_id as string))];
    urgentIdsTruncated = allIds.length > 500;
    urgentIds = allIds.slice(0, 500);
    if (urgentIds.length === 0) {
      return {
        features: [] as PublicMapFeature[],
        totalMatches: 0,
        totalFeatures: 0,
        truncated: false,
        mode: "institutions" as const,
        strategy: "bounded-fallback",
      };
    }
  }

  let builder = supabase
    .from("institutions")
    .select(
      "id,name,category,city,approximate_area,public_lat,public_lng,accepts_donations,is_verified,is_location_hidden,source",
      { count: "exact" }
    )
    .gte("public_lng", minLng)
    .lte("public_lng", maxLng)
    .gte("public_lat", minLat)
    .lte("public_lat", maxLat);

  if (query.categories.length > 0) builder = builder.in("category", query.categories);
  if (query.donationType) {
    builder = builder.contains("accepts_donations", [query.donationType]);
  }
  if (query.onlyZagreb) builder = builder.ilike("city", "Zagreb%");
  // Same equality semantics as the RPC, so a degraded response filters the
  // same set rather than quietly widening it.
  if (query.city) builder = builder.ilike("city", query.city);
  if (urgentIds) builder = builder.in("id", urgentIds);
  if (query.query) {
    const safeQuery = safeFallbackSearch(query.query);
    if (safeQuery) {
      builder = builder.or(`name.ilike.%${safeQuery}%,city.ilike.%${safeQuery}%`);
    }
  }

  const { data, error, count } = await builder
    .order("is_verified", { ascending: false })
    .order("name", { ascending: true })
    .limit(query.limit);
  if (error) throw new Error(`Bounded map query failed (${error.code})`);

  const features: PublicMapInstitution[] = ((data ?? []) as FallbackInstitutionRow[])
    .map((row) => {
      return {
        kind: "institution" as const,
        id: row.id,
        entityType: "institution" as const,
        registryId: null,
        name: row.name,
        category: row.category,
        city: row.city,
        address: null,
        approximateArea: row.approximate_area,
        latitude: row.public_lat,
        longitude: row.public_lng,
        acceptsDonations: row.accepts_donations ?? [],
        isVerified: Boolean(row.is_verified),
        isLocationHidden: Boolean(row.is_location_hidden),
        locationPrecision: row.is_location_hidden ? "hidden" as const : "exact" as const,
        trustStatus: trustStatus(Boolean(row.is_verified), row.source),
        hasUrgentNeed: Boolean(urgentIds?.includes(row.id)),
      };
    });
  const total = count ?? features.length;

  return {
    features,
    totalMatches: total,
    totalFeatures: total,
    truncated: urgentIdsTruncated || total > features.length,
    mode: "institutions" as const,
    strategy: "bounded-fallback",
  };
}

function jsonWithCache(
  req: NextRequest,
  response: PublicMapResponse,
  requestId: string,
  strategy: string
) {
  const body = JSON.stringify(response);
  const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
  const commonHeaders = {
    "Cache-Control": PUBLIC_CACHE_CONTROL,
    ETag: etag,
    Vary: "Accept-Encoding",
    "X-Map-Query-Strategy": strategy,
    "X-Request-Id": requestId,
  };

  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: commonHeaders });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      ...commonHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  let query: MapQuery;

  try {
    query = parseMapQuery(req.nextUrl.searchParams);
  } catch (error) {
    if (error instanceof MapQueryValidationError) {
      return NextResponse.json(
        { error: "Invalid map query", issues: error.issues },
        { status: 400, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
      );
    }
    throw error;
  }

  try {
    const result = (await queryIndexedRpc(query)) ?? (await queryBoundedFallback(query));
    const response: PublicMapResponse = {
      version: MAP_API_VERSION,
      features: result.features,
      meta: {
        returned: result.features.length,
        totalMatches: result.totalMatches,
        totalFeatures: result.totalFeatures,
        truncated: result.truncated,
        mode: result.mode,
        limit: query.limit,
      },
    };
    return jsonWithCache(req, response, requestId, result.strategy);
  } catch (error) {
    console.error("public_map_query_failed", {
      requestId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Institution locations are temporarily unavailable", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
    );
  }
}
