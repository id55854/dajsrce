import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { getRequestId } from "@/lib/observability";
import { NO_STORE, rateLimit } from "@/lib/security/http";

/** Current user's profile row + auth fallback (for Navbar and dashboards). */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked = rateLimit(req, { name: "me.get", limit: 60, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const profile = await getCurrentUserProfile();
  if (!profile) {
    return NextResponse.json({ profile: null }, { status: 401, headers: NO_STORE });
  }
  return NextResponse.json({ profile }, { headers: NO_STORE });
}
