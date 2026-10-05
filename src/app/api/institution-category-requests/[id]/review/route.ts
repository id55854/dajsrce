import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSecondFactor } from "@/lib/auth/mfa-server";
import { normalizeRole } from "@/lib/auth/roles";
import { getRequestId, logError } from "@/lib/observability";
import {
  categoryRequestErrorStatus,
  parseCategoryRequestReviewInput,
} from "@/lib/institution-category";
import {
  NO_STORE,
  isUuid,
  jsonError,
  rateLimit,
  requireSameOrigin,
  withRequestId,
} from "@/lib/security/http";

export const dynamic = "force-dynamic";

/**
 * Approve or reject an organisation's own type. Approval publishes the text
 * on the public profile and sets the category the organisation is filtered
 * by (the reviewer's choice, else its current one). As with claim review,
 * the role check here gives a clean 403; `review_institution_category_request`
 * re-reads the reviewer's role in its own transaction, and two-step sign-in
 * is mandatory for administrators.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(req.headers);
  const { id } = await params;
  if (!isUuid(id)) {
    return jsonError("Invalid request id", 400, requestId, NO_STORE);
  }
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "institution_category.review", limit: 30, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  const { data: reviewer } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (normalizeRole(reviewer?.role ?? null) !== "superadmin") {
    return jsonError("Not authorised", 403, requestId, NO_STORE);
  }
  const mfaBlocked = await requireSecondFactor(supabase, user, requestId);
  if (mfaBlocked) return mfaBlocked;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400, requestId, NO_STORE);
  }
  const parsed = parseCategoryRequestReviewInput(raw);
  if (!parsed.ok) return jsonError(parsed.error, 400, requestId, NO_STORE);

  const { data, error } = await supabaseAdmin.rpc("review_institution_category_request", {
    p_reviewer_id: user.id,
    p_request_id: id,
    p_decision: parsed.value.decision,
    p_category: parsed.value.category,
    p_note: parsed.value.note,
  });

  if (error) {
    logError("institution_category.review_failed", error, {
      request_id: requestId,
      decision: parsed.value.decision,
      code: error.code ?? null,
    });
    return jsonError(
      "The decision could not be recorded",
      categoryRequestErrorStatus(error.code),
      requestId,
      NO_STORE
    );
  }

  return NextResponse.json(
    { request: data },
    { headers: withRequestId(NO_STORE, requestId) }
  );
}
