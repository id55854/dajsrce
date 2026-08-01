import { NextResponse } from "next/server";

/**
 * Database seeding is intentionally unavailable over HTTP. Use an audited,
 * local-only maintenance script against an explicitly selected environment.
 */
export async function POST() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
