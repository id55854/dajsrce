import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Issue a short-lived bearer token for an institution's onsite QR code.
 * Only the hash is stored. Tokens are available from the day before the event
 * through the event day so an old public event URL is not a check-in proof.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [{ data: profile }, { data: event }] = await Promise.all([
    supabase.from("profiles").select("role, institution_id").eq("id", user.id).maybeSingle(),
    supabase
      .from("volunteer_events")
      .select("id, institution_id, event_date")
      .eq("id", eventId)
      .maybeSingle(),
  ]);
  if (!profile || profile.role !== "ngo" || !profile.institution_id) {
    return NextResponse.json({ error: "Institution access required" }, { status: 403 });
  }
  if (!event || event.institution_id !== profile.institution_id) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const eventUtc = Date.parse(`${event.event_date}T00:00:00.000Z`);
  const day = 24 * 60 * 60 * 1000;
  if (!Number.isFinite(eventUtc) || eventUtc < todayUtc - day || eventUtc > todayUtc + day) {
    return NextResponse.json(
      { error: "The onsite QR code becomes available one day before the event" },
      { status: 409 }
    );
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const eventDayExpiry = Date.parse(`${event.event_date}T23:59:59.999Z`);
  const expiresAt = new Date(Math.min(eventDayExpiry + 3 * 60 * 60 * 1000, Date.now() + day)).toISOString();

  const { error } = await supabaseAdmin.from("volunteer_checkin_tokens").insert({
    event_id: eventId,
    token_hash: tokenHash,
    created_by: user.id,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[check-in-token] insert failed", error);
    return NextResponse.json({ error: "Could not create the check-in code" }, { status: 500 });
  }

  return NextResponse.json(
    { token, expires_at: expiresAt },
    { headers: { "Cache-Control": "no-store" } }
  );
}
