import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { claimErrorStatus } from "@/lib/institution-claims";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Withdraw an open claim. Ownership is verified inside the transaction. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const { id } = await params;

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

  const { data, error } = await supabaseAdmin.rpc(
    "withdraw_institution_claim_transaction",
    { p_actor_id: user.id, p_claim_id: id }
  );

  if (error) {
    logError("institution_claim.withdraw_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return NextResponse.json(
      { error: "The claim could not be withdrawn", request_id: requestId },
      { status: claimErrorStatus(error.code), headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { claim: data, request_id: requestId },
    { headers: { ...NO_STORE, "x-request-id": requestId } }
  );
}
