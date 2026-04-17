import { NextResponse } from "next/server";
import { getCurrentUserProfile } from "@/lib/auth/server";

/** Current user's profile row + auth fallback (for Navbar and dashboards). */
export async function GET() {
  const profile = await getCurrentUserProfile();
  if (!profile) {
    return NextResponse.json({ profile: null }, { status: 401 });
  }
  return NextResponse.json({ profile });
}
