import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, isUuid, jsonError, rateLimit, requireSameOrigin } from "@/lib/security/http";

const TAX_CATEGORIES = new Set([
  "cultural",
  "scientific",
  "educational",
  "health",
  "humanitarian",
  "sports",
  "religious",
  "environmental",
  "other_public_benefit",
]);

export async function GET(_req: NextRequest) {
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ pledges: [] });
    }

    const { data, error } = await supabase
      .from("pledges")
      .select(
        "id, need_id, quantity, message, status, tax_category, amount_eur, delivered_at, fulfilled_at, created_at, need:needs(id, title, urgency, quantity_needed, quantity_pledged, institution:institutions(id, name, category))"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ pledges: data ?? [] });
  } catch {
    return NextResponse.json({ pledges: [] });
  }
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "pledges.post", limit: 30, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return jsonError("Not authenticated", 401, requestId, NO_STORE);
    }

    const { data: existingProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !existingProfile) {
      return NextResponse.json(
        { error: "Profile setup is incomplete", request_id: requestId },
        { status: 409 }
      );
    }

    // Giving is a citizen action. An NGO account exists to publish needs and
    // receive, so it does not pledge against anyone's need, including its own,
    // which this same check covers without having to compare institutions.
    // The role is read from `profiles`, never from the request body.
    if (existingProfile.role === "ngo") {
      return NextResponse.json(
        { error: "An NGO account cannot pledge", request_id: requestId },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON", request_id: requestId },
        { status: 400 }
      );
    }
    const { need_id, quantity, message, tax_category, amount_eur } = body as {
      need_id?: string;
      quantity?: number;
      message?: string;
      tax_category?: string;
      amount_eur?: number | null;
    };
    const qty = quantity ?? 1;

    if (typeof need_id !== "string" || !isUuid(need_id)) {
      return NextResponse.json(
        { error: "need_id is invalid", request_id: requestId },
        { status: 400 }
      );
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 1_000_000) {
      return NextResponse.json(
        { error: "quantity must be an integer between 1 and 1000000", request_id: requestId },
        { status: 400 }
      );
    }
    if (typeof message === "string" && message.length > 2000) {
      return NextResponse.json(
        { error: "message must be at most 2000 characters", request_id: requestId },
        { status: 400 }
      );
    }
    const resolvedTaxCategory = tax_category ?? "humanitarian";
    if (!TAX_CATEGORIES.has(resolvedTaxCategory)) {
      return NextResponse.json(
        { error: "Invalid tax category", request_id: requestId },
        { status: 400 }
      );
    }
    const amt = amount_eur == null ? null : Number(amount_eur);
    if (amt !== null && (!Number.isFinite(amt) || amt < 0 || amt > 1_000_000_000)) {
      return NextResponse.json(
        { error: "amount_eur is invalid", request_id: requestId },
        { status: 400 }
      );
    }
    const { data, error } = await supabaseAdmin.rpc("create_pledge_transaction", {
      p_user_id: user.id,
      p_need_id: need_id,
      p_quantity: qty,
      p_message: typeof message === "string" ? message : null,
      p_tax_category: resolvedTaxCategory,
      p_amount_eur: amt === null ? null : Math.round(amt * 100) / 100,
    });

    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
      logError("pledges.create_transaction_failed", error, {
        request_id: requestId,
        code: error.code,
      });
      return NextResponse.json(
        { error: "Pledge could not be created", request_id: requestId },
        { status }
      );
    }

    return NextResponse.json(data, {
      status: 201,
      headers: { "x-request-id": requestId },
    });
  } catch (error) {
    logError("pledges.create_failed", error, { request_id: requestId });
    return NextResponse.json(
      { error: "Pledge could not be created", request_id: requestId },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
