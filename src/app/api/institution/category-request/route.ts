import { NextResponse, NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSecondFactorIfEnrolled } from "@/lib/auth/mfa-server";
import { getRequestId, logError } from "@/lib/observability";
import {
  NO_STORE,
  jsonError,
  rateLimit,
  requireSameOrigin,
  withRequestId,
} from "@/lib/security/http";
import {
  CATEGORY_LABEL_LIMITS,
  categoryRequestErrorStatus,
  normalizeCategoryLabel,
} from "@/lib/institution-category";

/**
 * The linked NGO proposes its own type when none of the listed categories
 * fits. Nothing is published here: `request_institution_category_label`
 * queues the text for the administrators (replacing an open request's text)
 * and notifies them; only their approval puts it on the public profile.
 * The organisation comes from the actor's `ngo` profile, never the body.
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "institution.category_request", limit: 10, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }
  const mfaBlocked = await requireSecondFactorIfEnrolled(supabase, user, requestId);
  if (mfaBlocked) return mfaBlocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400, requestId, NO_STORE);
  }
  const label = normalizeCategoryLabel(
    body !== null && typeof body === "object" ? (body as Record<string, unknown>).label : null
  );
  if (!label) {
    return jsonError(
      `label must be ${CATEGORY_LABEL_LIMITS.min}-${CATEGORY_LABEL_LIMITS.max} characters`,
      400,
      requestId,
      NO_STORE
    );
  }

  const { data, error } = await supabaseAdmin.rpc("request_institution_category_label", {
    p_actor_id: user.id,
    p_label: label,
  });

  if (error) {
    logError("institution.category_request_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    // P0001 here is the daily request cap.
    const status = error.code === "P0001" ? 429 : categoryRequestErrorStatus(error.code);
    return jsonError("The request could not be sent", status, requestId, NO_STORE);
  }

  return NextResponse.json(
    { request: data },
    { headers: withRequestId(NO_STORE, requestId) }
  );
}
