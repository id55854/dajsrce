import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import {
  claimErrorStatus,
  parseClaimRequestInput,
  type OwnInstitutionClaim,
} from "@/lib/institution-claims";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

async function requireActor() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** The signed-in account's own claim, if it has one. */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const actorId = await requireActor();
  if (!actorId) {
    return NextResponse.json(
      { error: "Not authenticated", request_id: requestId },
      { status: 401, headers: NO_STORE }
    );
  }

  const { data, error } = await supabaseAdmin.rpc("get_own_institution_claim", {
    p_actor_id: actorId,
  });

  if (error) {
    logError("institution_claim.read_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return NextResponse.json(
      { error: "Claims are temporarily unavailable", request_id: requestId },
      { status: claimErrorStatus(error.code), headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { claim: (data as OwnInstitutionClaim | null) ?? null, request_id: requestId },
    { headers: { ...NO_STORE, "x-request-id": requestId } }
  );
}

/** Request a claim on one organisation in the published registry snapshot. */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const actorId = await requireActor();
  if (!actorId) {
    return NextResponse.json(
      { error: "Not authenticated", request_id: requestId },
      { status: 401, headers: NO_STORE }
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

  const parsed = parseClaimRequestInput(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, request_id: requestId },
      { status: 400, headers: NO_STORE }
    );
  }

  // Every eligibility rule, snapshot membership, "already linked", "already
  // claimed", "one open claim per account", is enforced inside the RPC's
  // transaction, not here.
  const { data, error } = await supabaseAdmin.rpc(
    "request_institution_claim_transaction",
    {
      p_actor_id: actorId,
      p_udr_id: parsed.value.udrId,
      p_contact_email: parsed.value.contactEmail,
      p_note: parsed.value.evidenceNote,
    }
  );

  if (error) {
    logError("institution_claim.request_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return NextResponse.json(
      { error: "The claim could not be submitted", request_id: requestId },
      { status: claimErrorStatus(error.code), headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { claim: data, request_id: requestId },
    { status: 201, headers: { ...NO_STORE, "x-request-id": requestId } }
  );
}
