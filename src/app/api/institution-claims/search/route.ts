import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import {
  claimErrorStatus,
  parseClaimSearchInput,
  type ClaimableAssociation,
} from "@/lib/institution-claims";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * The organisation picker. Signed-in only, requires a query and caps the page
 * hard; this is a lookup, never a way to page the national catalogue.
 */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);

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

  const parsed = parseClaimSearchInput(req.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, request_id: requestId },
      { status: 400, headers: NO_STORE }
    );
  }

  const { data, error } = await supabaseAdmin.rpc("search_claimable_associations_v1", {
    p_query: parsed.value.query,
    p_county: parsed.value.county,
    p_limit: parsed.value.limit,
  });

  if (error) {
    logError("institution_claim.search_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return NextResponse.json(
      { error: "The official register is temporarily unavailable", request_id: requestId },
      { status: claimErrorStatus(error.code), headers: NO_STORE }
    );
  }

  const payload = (data ?? {}) as { items?: ClaimableAssociation[] };
  return NextResponse.json(
    { items: Array.isArray(payload.items) ? payload.items : [], request_id: requestId },
    { headers: { ...NO_STORE, "x-request-id": requestId } }
  );
}
