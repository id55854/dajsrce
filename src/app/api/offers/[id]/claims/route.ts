import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  OFFERS_API_VERSION,
  OfferValidationError,
  isOfferIdentifier,
  offerErrorStatus,
  parseOfferClaimInput,
} from "@/lib/offers";

export const dynamic = "force-dynamic";

function headers(requestId: string) {
  return { "Cache-Control": "no-store", "X-Request-Id": requestId } as const;
}

/**
 * A verified organisation asks for an offer.
 *
 * This route never inspects the caller's role. `claim_donor_offer_transaction`
 * resolves the organisation from `p_actor_id`, requires `is_verified = true`
 * and takes the offer's row lock before inserting, so registry presence or a
 * self-declared role in a request body buys nothing here.
 */
export async function POST(
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

  let body: unknown = {};
  if (req.headers.get("content-length") !== "0") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  let input;
  try {
    input = parseOfferClaimInput(body);
  } catch (error) {
    if (error instanceof OfferValidationError) {
      return NextResponse.json(
        { error: "Invalid claim", issues: error.issues, requestId },
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

    const { data, error } = await supabaseAdmin.rpc("claim_donor_offer_transaction", {
      p_actor_id: user.id,
      p_offer_id: id,
      p_message: input.message,
    });

    if (error) {
      console.error("offer_claim_failed", {
        requestId,
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        { error: "Offer could not be claimed", requestId },
        { status: offerErrorStatus(error.code), headers: headers(requestId) }
      );
    }

    const claim = (data ?? {}) as Record<string, unknown>;
    return NextResponse.json(
      {
        version: OFFERS_API_VERSION,
        claim: {
          id: String(claim.id ?? ""),
          offer_id: String(claim.offer_id ?? ""),
          institution_id: String(claim.institution_id ?? ""),
          status: String(claim.status ?? "requested"),
          message: typeof claim.message === "string" ? claim.message : null,
          created_at: String(claim.created_at ?? ""),
          responded_at:
            typeof claim.responded_at === "string" ? claim.responded_at : null,
        },
      },
      { status: 201, headers: headers(requestId) }
    );
  } catch (error) {
    console.error("offer_claim_unavailable", {
      requestId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Offer could not be claimed", requestId },
      { status: 503, headers: headers(requestId) }
    );
  }
}
