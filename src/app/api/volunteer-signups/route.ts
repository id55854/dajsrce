import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getVerifiedClaims } from "@/lib/auth/claims";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, isUuid, jsonError, rateLimit, requireSameOrigin, withRequestId } from "@/lib/security/http";
import { capacityErrorCode } from "@/lib/capacity-errors";

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked = rateLimit(req, { name: "volunteer_signups.get", limit: 60, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    // Read path: the JWT is verified locally; RLS scopes the rows to the user.
    const user = await getVerifiedClaims(supabase);
    if (!user) {
      return NextResponse.json({ signups: [] }, { headers: NO_STORE });
    }

    // Which events this person is already signed up for, and the signup id
    // their own withdraw control needs: a signup has no state beyond existing.
    const { data, error } = await supabase
      .from("volunteer_signups")
      .select("id, event_id")
      .eq("user_id", user.id)
      .is("cancelled_at", null);

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
      // The card needs to tell "already yours" from "full" from "over".
      const code = capacityErrorCode(error);
      if (code) {
        return NextResponse.json(
          { error: "Could not sign up for this event", code, request_id: requestId },
          { status, headers: withRequestId(NO_STORE, requestId) }
        );
      }
      return jsonError("Could not sign up for this event", status, requestId, NO_STORE);
    }

    return NextResponse.json({ signup: data }, { status: 201 });
  } catch (error) {
    logError("volunteer_signups.create_failed", error, { request_id: requestId });
    return jsonError("Failed to sign up", 500, requestId, NO_STORE);
  }
}
