import { NextResponse } from "next/server";

/**
 * Browser location is used client-side to move the map. Exact user coordinates
 * are not accepted here, which keeps the product promise true.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Location storage is not available" },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
