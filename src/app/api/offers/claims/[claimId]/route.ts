import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  OFFERS_API_VERSION,
  OfferValidationError,
  isOfferIdentifier,
  offerErrorStatus,
  parseOfferClaimDecisionInput,
  toAuthorOffer,
} from "@/lib/offers";

export const dynamic = "force-dynamic";

function headers(requestId: string) {
  return { "Cache-Control": "no-store", "X-Request-Id": requestId } as const;
}

/**
 * Answer a claim.
 *
 * `accepted` / `declined` are the author's calls; `withdrawn` is the requesting
 * organisation's. Each maps to a different transactional RPC and each RPC
 * derives the caller's standing from `p_actor_id` under the offer's row lock —
 * accepting one claim declines every other outstanding request for that offer
 * inside the same transaction.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ claimId: string }> }
) {
  const requestId = randomUUID();
  const { claimId } = await context.params;

  if (!isOfferIdentifier(claimId)) {
    return NextResponse.json(
      { error: "Invalid claim identifier", requestId },
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
    input = parseOfferClaimDecisionInput(body);
  } catch (error) {
    if (error instanceof OfferValidationError) {
      return NextResponse.json(
        { error: "Invalid claim decision", issues: error.issues, requestId },
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
      input.decision === "withdrawn"
        ? await supabaseAdmin.rpc("withdraw_offer_claim_transaction", {
            p_actor_id: user.id,
            p_claim_id: claimId,
          })
        : await supabaseAdmin.rpc("respond_to_offer_claim_transaction", {
            p_actor_id: user.id,
            p_claim_id: claimId,
            p_decision: input.decision,
          });

    if (error) {
      console.error("offer_claim_decision_failed", {
        requestId,
        decision: input.decision,
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        { error: "Claim could not be updated", requestId },
        { status: offerErrorStatus(error.code), headers: headers(requestId) }
      );
    }

    const payload = (data ?? {}) as Record<string, unknown>;
    const claimSource = (
      input.decision === "withdrawn" ? payload : payload.claim ?? {}
    ) as Record<string, unknown>;

    return NextResponse.json(
      {
        version: OFFERS_API_VERSION,
        claim: {
          id: String(claimSource.id ?? ""),
          offer_id: String(claimSource.offer_id ?? ""),
          institution_id: String(claimSource.institution_id ?? ""),
          status: String(claimSource.status ?? ""),
          responded_at:
            typeof claimSource.responded_at === "string"
              ? claimSource.responded_at
              : null,
        },
        offer: payload.offer == null ? null : toAuthorOffer(payload.offer),
        declined_others:
          typeof payload.declined_others === "number" ? payload.declined_others : 0,
      },
      { status: 200, headers: headers(requestId) }
    );
  } catch (error) {
    console.error("offer_claim_decision_unavailable", {
      requestId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Claim could not be updated", requestId },
      { status: 503, headers: headers(requestId) }
    );
  }
}
