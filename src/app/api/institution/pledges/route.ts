import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, jsonError } from "@/lib/security/http";

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const { data: pledges, error } = await supabase
    .from("pledges")
    .select(
      `
      id,
      user_id,
      need_id,
      quantity,
      status,
      amount_eur,
      delivered_at,
      tax_category,
      created_at,
      need:needs(title),
      pledge_acknowledgements(id, kind, signed_at, notes)
    `
    )
    .in("need_id", needIds)
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
