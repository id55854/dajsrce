import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  MAP_CITY_LIMIT,
  MAP_CITY_LIMIT_MAX,
  MAP_CITY_QUERY_MAX_LENGTH,
  type PublicMapCitiesResponse,
  type PublicMapCity,
} from "@/lib/location-map";
import { createPublicSupabaseClient } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

// The published snapshot changes at most once a day, and the response is a
// pure aggregate, so it is worth caching hard at the edge.
const PUBLIC_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

type RpcCityRow = {
  city: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  organisation_count: number | string | null;
};

function rowToCity(row: RpcCityRow): PublicMapCity | null {
  if (!row.city || !row.county) return null;
  if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return null;
  return {
    city: row.city,
    county: row.county,
    latitude: row.latitude as number,
    longitude: row.longitude as number,
    organisationCount: Number(row.organisation_count ?? 0),
  };
}

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  const rawQuery = req.nextUrl.searchParams.get("q") ?? "";
  const rawLimit = req.nextUrl.searchParams.get("limit");

  if (rawQuery.length > MAP_CITY_QUERY_MAX_LENGTH) {
    return NextResponse.json(
      { error: "Invalid city query", issues: ["q is too long"] },
      { status: 400, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
    );
  }

  const parsedLimit = rawLimit == null ? MAP_CITY_LIMIT : Number(rawLimit);
  if (
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > MAP_CITY_LIMIT_MAX
  ) {
    return NextResponse.json(
      {
        error: "Invalid city query",
        issues: [`limit must be between 1 and ${MAP_CITY_LIMIT_MAX}`],
      },
      { status: 400, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
    );
  }

  try {
    const supabase = createPublicSupabaseClient();
    const { data, error } = await supabase.rpc("registry_map_cities_v1", {
      p_query: rawQuery.trim() || null,
      p_limit: parsedLimit,
    });
    if (error) throw new Error(`City directory query failed (${error.code ?? "database"})`);

    const cities = ((data ?? []) as RpcCityRow[])
      .map(rowToCity)
      .filter((city): city is PublicMapCity => city != null);

    const response: PublicMapCitiesResponse = { cities };
    const body = JSON.stringify(response);
    const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
    const headers = {
      "Cache-Control": PUBLIC_CACHE_CONTROL,
      ETag: etag,
      Vary: "Accept-Encoding",
      "X-Request-Id": requestId,
    };

    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers });
    }

    return new NextResponse(body, {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    console.error("public_map_cities_failed", {
      requestId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "City list is temporarily unavailable", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
    );
  }
}
