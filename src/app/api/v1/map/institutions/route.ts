import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  MAP_API_VERSION,
  MapQueryValidationError,
  buildMapQueryString,
  parseMapQuery,
  type MapQuery,
  type PublicMapResponse,
} from "@/lib/location-map";
import { logError } from "@/lib/observability";
import { rateLimit } from "@/lib/security/http";
import { PublicSupabaseConfigError } from "@/lib/supabase/public";
import { loadPublicMap } from "@/lib/public-map-data";

export const dynamic = "force-dynamic";

const PUBLIC_CACHE_MAX_AGE_SECONDS = 300;
const PUBLIC_CACHE_CONTROL = `public, s-maxage=${PUBLIC_CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=3600`;

/**
 * The validator is derived from the canonical query and the current
 * `s-maxage` window, not from the response body, so a matching
 * `If-None-Match` is answered before any database work. Within one window the
 * cache contract already promises nothing fresher, which is what makes the
 * shortcut honest; the `W/` prefix says so explicitly. When the window rolls
 * over the tag changes and the next request recomputes.
 */
function semanticEtag(query: MapQuery, now = Date.now()): string {
  const window = Math.floor(now / (PUBLIC_CACHE_MAX_AGE_SECONDS * 1000));
  const digest = createHash("sha256")
    .update(`v${MAP_API_VERSION}|${window}|${buildMapQueryString(query)}`)
    .digest("base64url");
  return `W/"${digest}"`;
}

function cacheHeaders(etag: string, requestId: string, strategy: string) {
  return {
    "Cache-Control": PUBLIC_CACHE_CONTROL,
    ETag: etag,
    Vary: "Accept-Encoding",
    "X-Map-Query-Strategy": strategy,
    "X-Request-Id": requestId,
  };
}

function jsonWithCache(
  response: PublicMapResponse,
  etag: string,
  requestId: string,
  strategy: string
) {
  return new NextResponse(JSON.stringify(response), {
    status: 200,
    headers: {
      ...cacheHeaders(etag, requestId, strategy),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/**
 * A deployment with no credentials is still a 503 — nothing here can serve a
 * map — but the body says which variables are absent, and it says it only
 * outside production. Production keeps the existing opaque answer, because
 * telling the open internet that an environment is half-configured is an
 * invitation, not a diagnostic.
 */
function notConfigured(error: PublicSupabaseConfigError, requestId: string) {
  logError("public_map_not_configured", error, { request_id: requestId, missing: error.missing.join(",") });
  const developerDetail =
    process.env.NODE_ENV === "production"
      ? {}
      : {
          code: "not_configured" as const,
          missing: error.missing,
          hint: "Copy .env.example to .env.local, fill in your Supabase project URL and anon key, then restart the dev server.",
        };
  return NextResponse.json(
    {
      error: "Institution locations are temporarily unavailable",
      requestId,
      ...developerDetail,
    },
    { status: 503, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
  );
}

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  // The map issues one request per settled pan (160 ms debounce), so a
  // legitimate visitor stays far below this; it bounds a scripted flood.
  const blocked = rateLimit(req, { name: "public.map.institutions", limit: 240, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;
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

  // Cheap first: a revalidation inside the current cache window is answered
  // from the query alone, so a 304 costs no database time.
  const etag = semanticEtag(query);
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: cacheHeaders(etag, requestId, "not-modified"),
    });
  }

  try {
    const { response, strategy } = await loadPublicMap(query);
    return jsonWithCache(response, etag, requestId, strategy);
  } catch (error) {
    if (error instanceof PublicSupabaseConfigError) {
      return notConfigured(error, requestId);
    }
    logError("public_map_query_failed", error, { request_id: requestId });
    return NextResponse.json(
      { error: "Institution locations are temporarily unavailable", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
    );
  }
}
