import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Short shared-cache window for public lists that change when an NGO
 * publishes something (needs, volunteer events). A minute of staleness is
 * invisible to a visitor and turns N visitors into one database read.
 */
export const PUBLIC_LIST_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";

/**
 * Serialise a public, visitor-independent list with CDN caching and a
 * body-derived ETag. Only for responses built from the stateless anon client:
 * anything that read cookies must stay `no-store`.
 */
export function publicListResponse(
  req: NextRequest,
  payload: Record<string, unknown>,
  requestId: string
): NextResponse {
  const body = JSON.stringify({ ...payload, request_id: requestId });
  const etag = `"${createHash("sha256").update(JSON.stringify(payload)).digest("base64url")}"`;
  const headers = {
    "Cache-Control": PUBLIC_LIST_CACHE_CONTROL,
    ETag: etag,
    Vary: "Accept-Encoding",
    "x-request-id": requestId,
  };
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(body, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}
