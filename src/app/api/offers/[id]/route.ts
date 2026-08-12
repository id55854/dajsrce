import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  OFFERS_API_VERSION,
  OfferValidationError,
  isOfferIdentifier,
  offerErrorStatus,
  parseOfferUpdateInput,
  toAuthorOffer,
} from "@/lib/offers";

export const dynamic = "force-dynamic";

function headers(requestId: string) {
  return { "Cache-Control": "no-store", "X-Request-Id": requestId } as const;
}

/**
 * Author-only edit and lifecycle transition. Ownership is never checked here —
 * both RPCs re-derive it from `p_actor_id` under the offer's row lock, so a
 * forged id cannot race past this route.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = randomUUID();
  const { id } = await context.params;

  if (!isOfferIdentifier(id)) {
    return NextResponse.json(
      { error: "Invalid offer identifier", requestId },
      { status: 400, headers: headers(requestId) }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", requestId },
      { status: 400, headers: headers(requestId) }
    );
  }

  let input;
  try {
    input = parseOfferUpdateInput(body);
  } catch (error) {
    if (error instanceof OfferValidationError) {
      return NextResponse.json(
        { error: "Invalid offer update", issues: error.issues, requestId },
        { status: 400, headers: headers(requestId) }
      );
    }
    throw error;
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated", requestId },
        { status: 401, headers: headers(requestId) }
      );
    }

    const { data, error } =
      input.kind === "status"
        ? await supabaseAdmin.rpc("set_donor_offer_status_transaction", {
            p_actor_id: user.id,
            p_offer_id: id,
            p_status: input.status,
          })
        : await supabaseAdmin.rpc("update_donor_offer_transaction", {
            p_actor_id: user.id,
            p_offer_id: id,
            p_title: input.title,
            p_description: input.description,
            p_quantity: input.quantity,
            p_unit: input.unit,
            p_available_until: input.availableUntil,
            p_clear_available_until: input.clearAvailableUntil,
          });

    if (error) {
      console.error("offer_update_failed", {
        requestId,
        kind: input.kind,
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        { error: "Offer could not be updated", requestId },
        { status: offerErrorStatus(error.code), headers: headers(requestId) }
      );
    }

    return NextResponse.json(
      { version: OFFERS_API_VERSION, offer: toAuthorOffer(data) },
      { status: 200, headers: headers(requestId) }
    );
  } catch (error) {
    console.error("offer_update_unavailable", {
      requestId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Offer could not be updated", requestId },
      { status: 503, headers: headers(requestId) }
    );
  }
}
