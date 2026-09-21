import { NextResponse, NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { getVerifiedClaims } from "@/lib/auth/claims";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, jsonError, rateLimit } from "@/lib/security/http";
import { toPublicInstitutionDetail, type PublicInstitutionDetailRpcRow } from "@/lib/location-map";

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
