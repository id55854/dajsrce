import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeRole } from "@/lib/auth/roles";
import { getRequestId, logError } from "@/lib/observability";
import {
  claimErrorCode,
  claimErrorStatus,
  parseClaimReviewInput,
} from "@/lib/institution-claims";
import { isUuid, jsonError, rateLimit, requireSameOrigin } from "@/lib/security/http";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Approve or reject a claim. A review is a mutation, so the reviewer comes
 * from `auth.getUser()` (a round trip that honours a revoked session), not
 * from a locally verified JWT. The route checks the superadmin role for a
 * clean 403, but that check is not what protects the data: both RPCs re-read
 * `public.profiles.role` for `p_reviewer_id` inside their own transaction and
 * refuse anyone who is not an administrator.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(req.headers);
  const { id } = await params;
  if (!isUuid(id)) {
    return jsonError("Invalid claim id", 400, requestId, NO_STORE);
  }
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "institution_claims.review", limit: 30, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Not authenticated", request_id: requestId },
      { status: 401, headers: NO_STORE }
    );
  }

  const { data: reviewer } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (normalizeRole(reviewer?.role ?? null) !== "superadmin") {
    return NextResponse.json(
      { error: "Not authorised", request_id: requestId },
      { status: 403, headers: NO_STORE }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", request_id: requestId },
      { status: 400, headers: NO_STORE }
    );
  }

  const parsed = parseClaimReviewInput(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, request_id: requestId },
      { status: 400, headers: NO_STORE }
    );
  }

  const rpc =
    parsed.value.decision === "approve"
      ? "approve_institution_claim_transaction"
      : "reject_institution_claim_transaction";

  const { data, error } = await supabaseAdmin.rpc(rpc, {
    p_reviewer_id: user.id,
    p_claim_id: id,
    p_note: parsed.value.note,
  });

  if (error) {
    logError("institution_claim.review_failed", error, {
      request_id: requestId,
      decision: parsed.value.decision,
      code: error.code ?? null,
    });
    const code = claimErrorCode(error);
    return NextResponse.json(
      {
        error: "The decision could not be recorded",
        ...(code ? { code } : {}),
        request_id: requestId,
      },
      { status: claimErrorStatus(error.code), headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { claim: data, request_id: requestId },
    { headers: { ...NO_STORE, "x-request-id": requestId } }
  );
}
