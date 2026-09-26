import { NextResponse, NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getVerifiedClaims } from "@/lib/auth/claims";
import { getRequestId, logError } from "@/lib/observability";
import {
  NO_STORE,
  jsonError,
  rateLimit,
  requireSameOrigin,
  withRequestId,
} from "@/lib/security/http";
import { toPublicInstitutionDetail, type PublicInstitutionDetailRpcRow } from "@/lib/location-map";
import {
  parseInstitutionProfilePatch,
  profileFieldFromMessage,
  type InstitutionProfileField,
} from "@/lib/institution-profile";

/** The signed-in NGO's own institution, for its dashboard profile card. */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked = rateLimit(req, { name: "institution.get", limit: 60, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const user = await getVerifiedClaims(supabase);
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("institution_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "ngo" || !profile.institution_id) {
    return jsonError("Institution access required", 403, requestId, NO_STORE);
  }

  // The RPC already serves this row to any visitor on the public detail
  // page; the auth check above only resolves which institution to read.
  const publicClient = createPublicSupabaseClient();
  const { data, error } = await publicClient.rpc("public_institution_detail_v1", {
    p_id: profile.institution_id,
  });

  if (error) {
    logError("institution.self_detail_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return jsonError("Institution details are temporarily unavailable", 500, requestId, NO_STORE);
  }

  const row = ((data ?? []) as PublicInstitutionDetailRpcRow[])[0] ?? null;
  return NextResponse.json(
    { institution: row ? toPublicInstitutionDetail(row) : null },
    { headers: NO_STORE }
  );
}

/**
 * The linked NGO edits its own public profile: contact, opening hours, when
 * and where it takes donations, and what it accepts.
 *
 * Nothing in the body names an institution. `update_own_institution_profile`
 * resolves it from the actor's `ngo` profile and refuses anyone else, and
 * direct UPDATE on `institutions` is revoked, so this is the only edit path.
 */
export async function PATCH(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "institution.patch", limit: 20, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400, requestId, NO_STORE);
  }
  const parsed = parseInstitutionProfilePatch(rawBody);
  if (!parsed.ok) return profileError(parsed.error, 400, requestId, parsed.field);

  const { data, error } = await supabaseAdmin.rpc("update_own_institution_profile", {
    p_actor_id: user.id,
    p_patch: parsed.value,
  });

  if (error) {
    const status =
      error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "22023" ? 400 : 500;
    logError("institution.profile_update_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    // The field name is what the form needs; the database message stays here.
    const field = status === 400 ? profileFieldFromMessage(error.message) : null;
    return profileError("Profile could not be updated", status, requestId, field);
  }

  return NextResponse.json(
    { institution: data },
    { headers: withRequestId(NO_STORE, requestId) }
  );
}

function profileError(
  error: string,
  status: number,
  requestId: string,
  field: InstitutionProfileField | null
) {
  return NextResponse.json(
    { error, ...(field ? { field } : {}), request_id: requestId },
    { status, headers: withRequestId(NO_STORE, requestId) }
  );
}
