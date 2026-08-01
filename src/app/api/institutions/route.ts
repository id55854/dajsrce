import { NextResponse } from "next/server";

/**
 * The original endpoint returned the full institution table and could expose
 * sensitive coordinates. It remains as an explicit compatibility signal so
 * stale clients fail visibly instead of receiving a silently truncated or
 * privacy-unsafe catalogue.
 */
export async function GET() {
  return NextResponse.json(
    {
      error: "This unbounded endpoint has been retired.",
      replacement: "/api/v1/map/institutions",
      requiredParameters: ["bbox", "zoom"],
      documentation:
        "Use the viewport-bounded v1 endpoint and fetch selected details from /api/v1/institutions/:id.",
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "public, s-maxage=86400",
        Deprecation: "true",
        Sunset: "Sat, 01 Aug 2026 00:00:00 GMT",
        Link: '</api/v1/map/institutions>; rel="successor-version"',
      },
    }
  );
}
