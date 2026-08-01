import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logError } from "@/lib/observability";

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const json = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { "x-request-id": requestId } });

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return json({ error: "Not authenticated" }, 401);
    }

    const { lat, lng } = await req.json();
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return json({ error: "Invalid coordinates" }, 400);
    }

    const { error } = await supabase
      .from("profiles")
      .update({ lat, lng })
      .eq("id", user.id);
    if (error) throw error;

    return json({ ok: true });
  } catch (error) {
    logError("location.save_failed", error, { request_id: requestId });
    return json({ error: "Failed to save location" }, 500);
  }
}
