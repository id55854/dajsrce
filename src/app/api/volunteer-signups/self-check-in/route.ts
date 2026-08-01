import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Volunteer marks arrival for an event they signed up for (QR flow). */
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let eventId: string;
  let token: string;
  try {
    const body = (await req.json()) as { event_id?: string; token?: string };
    if (!body.event_id || typeof body.event_id !== "string") {
      throw new Error("bad");
    }
    if (!body.token || typeof body.token !== "string" || body.token.length > 256) {
      throw new Error("bad");
    }
    eventId = body.event_id;
    token = body.token;
  } catch {
    return NextResponse.json({ error: "event_id and token required" }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: checkedInAt, error } = await supabaseAdmin.rpc(
    "volunteer_self_checkin_transaction",
    { p_user_id: user.id, p_event_id: eventId, p_token_hash: tokenHash }
  );

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    return NextResponse.json({ error: "Check-in link is invalid, expired, or unavailable" }, { status });
  }

  return NextResponse.json({ ok: true, checked_in_at: checkedInAt });
}
