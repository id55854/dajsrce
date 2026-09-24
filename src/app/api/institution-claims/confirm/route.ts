import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashBearerToken } from "@/lib/security/runtime";
import { rateLimit, requireSameOrigin } from "@/lib/security/http";
import { getRequestId, logError } from "@/lib/observability";
import { claimErrorStatus, isRawClaimToken } from "@/lib/institution-claims";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

type Confirmation = {
  claim_id: string;
  claim_status: string;
  udr_id: string;
  organisation_name: string | null;
  confirmed_at: string;
};

/**
 * Consume the mailbox challenge. POST-only and idempotency-free by design: the
 * RPC locks the claim, refuses a consumed or expired digest and stamps the
 * consumption exactly once. Confirming an email proves mailbox control; it
 * does not approve the claim.
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "institution_claims.confirm", limit: 20, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  let token = "";
  try {
    const body = (await req.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token.trim() : "";
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", request_id: requestId },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!isRawClaimToken(token)) {
    return NextResponse.json(
      { error: "The confirmation link is not valid", request_id: requestId },
      { status: 400, headers: NO_STORE }
    );
  }

  const { data, error } = await supabaseAdmin
    .rpc("confirm_institution_claim_email", { p_token_hash: hashBearerToken(token) })
    .single();

  if (error || !data) {
    logError(
      "institution_claim.email_confirm_rejected",
      error ?? new Error("no result"),
      { request_id: requestId, code: error?.code ?? null }
    );
    return NextResponse.json(
      { error: "The confirmation link is no longer valid", request_id: requestId },
      { status: claimErrorStatus(error?.code), headers: NO_STORE }
    );
  }

  const confirmation = data as Confirmation;
  return NextResponse.json(
    {
      claim_id: confirmation.claim_id,
      status: confirmation.claim_status,
      organisation_name: confirmation.organisation_name,
      confirmed_at: confirmation.confirmed_at,
      request_id: requestId,
    },
    { headers: { ...NO_STORE, "x-request-id": requestId } }
  );
}
