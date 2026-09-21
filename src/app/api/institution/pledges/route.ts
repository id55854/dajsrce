import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getVerifiedClaims } from "@/lib/auth/claims";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, jsonError, rateLimit } from "@/lib/security/http";

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked = rateLimit(req, { name: "institution.pledges.get", limit: 60, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const supabase = await createServerSupabaseClient();
  // Read path: locally verified JWT, role from the profiles row under RLS.
  const user = await getVerifiedClaims(supabase);
  if (!user) {
    return jsonError("Not authenticated", 401, requestId, NO_STORE);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("institution_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.institution_id || profile.role !== "ngo") {
    return jsonError("Institution access only", 403, requestId, NO_STORE);
  }

  const { data: needs } = await supabase
    .from("needs")
    .select("id")
    .eq("institution_id", profile.institution_id);

  const needIds = (needs ?? []).map((n) => n.id);
  if (needIds.length === 0) {
    return NextResponse.json({ pledges: [] });
  }

  // Statuses and acknowledgements are no longer part of the product, so they
  // are no longer projected: what the NGO needs is what was promised against
  // which need, and when. A withdrawn promise is left out rather than listed
  // as "cancelled".
  const { data: pledges, error } = await supabase
    .from("pledges")
    .select(
      `
      id,
      need_id,
      quantity,
      amount_eur,
      created_at,
      need:needs(title)
    `
    )
    .in("need_id", needIds)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });

  if (error) {
    logError("institution.pledges_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return jsonError("Pledges are temporarily unavailable", 500, requestId, NO_STORE);
  }

  return NextResponse.json({ pledges: pledges ?? [] });
}
