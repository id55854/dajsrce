import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, isUuid, jsonError, rateLimit, requireSameOrigin } from "@/lib/security/http";

export async function GET() {
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ signups: [] });
    }

    const { data, error } = await supabase
      .from("volunteer_signups")
      .select("event_id, checked_in_at, checked_out_at")
      .eq("user_id", user.id);

    if (error) throw error;
    return NextResponse.json({ signups: data ?? [] });
  } catch {
    return NextResponse.json({ signups: [] });
  }
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "volunteer_signups.post", limit: 30, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return jsonError("Not authenticated", 401, requestId, NO_STORE);
    }

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (!existingProfile) {
      return jsonError("Profile setup is incomplete", 409, requestId, NO_STORE);
    }

    let body: { event_id?: unknown };
    try {
      body = (await req.json()) as { event_id?: unknown };
    } catch {
      return jsonError("Invalid JSON", 400, requestId, NO_STORE);
    }
    const { event_id } = body;
    if (!isUuid(event_id)) {
      return jsonError("event_id is invalid", 400, requestId, NO_STORE);
    }

    const { data, error } = await supabaseAdmin.rpc("volunteer_signup_transaction", {
      p_user_id: user.id,
      p_event_id: event_id,
    });

    if (error) {
      const status = error.code === "P0002" ? 404 : 409;
      logError("volunteer_signups.create_transaction_failed", error, {
        request_id: requestId,
        code: error.code ?? null,
      });
      return jsonError("Could not sign up for this event", status, requestId, NO_STORE);
    }

    return NextResponse.json({ signup: data }, { status: 201 });
  } catch (error) {
    logError("volunteer_signups.create_failed", error, { request_id: requestId });
    return jsonError("Failed to sign up", 500, requestId, NO_STORE);
  }
}
