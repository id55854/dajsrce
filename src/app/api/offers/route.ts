import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  OFFERS_API_VERSION,
  OfferValidationError,
  offerErrorStatus,
  offerListItems,
  offerRpcArgs,
  parseOfferCreateInput,
  parseOfferListQuery,
  toAuthorOffer,
  toInstitutionOfferClaim,
  toOfferBrowseItem,
  toOfferListMeta,
} from "@/lib/offers";

export const dynamic = "force-dynamic";

// Every response here is scoped to one signed-in person or one organisation.
// A shared cache entry would be a cross-tenant leak, so nothing is cacheable.
const PRIVATE_HEADERS = { "Cache-Control": "no-store" } as const;

function headers(requestId: string) {
  return { ...PRIVATE_HEADERS, "X-Request-Id": requestId };
}

const SCOPE_RPC = {
  open: "list_open_donor_offers",
  mine: "list_own_donor_offers",
  inbox: "list_institution_offer_claims",
} as const;

export async function GET(req: NextRequest) {
  const requestId = randomUUID();

  let query;
  try {
    query = parseOfferListQuery(req.nextUrl.searchParams);
  } catch (error) {
    if (error instanceof OfferValidationError) {
      return NextResponse.json(
        { error: "Invalid offer query", issues: error.issues, requestId },
        { status: 400, headers: headers(requestId) }
      );
    }
    throw error;
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Offers describe what a private individual has at home. Anonymous reads
    // are refused outright rather than being served an empty list.
    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated", requestId },
        { status: 401, headers: headers(requestId) }
      );
    }

    const args =
      query.scope === "open"
        ? {
            p_actor_id: user.id,
            p_donation_type: query.donationType,
            p_city: query.city,
            p_query: query.query,
            p_limit: query.limit,
            p_offset: query.offset,
          }
        : { p_actor_id: user.id, p_limit: query.limit, p_offset: query.offset };

    const { data, error } = await supabaseAdmin.rpc(SCOPE_RPC[query.scope], args);
    if (error) {
      console.error("offers_list_failed", {
        requestId,
        scope: query.scope,
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        { error: "Offers could not be listed", requestId },
        { status: offerErrorStatus(error.code), headers: headers(requestId) }
      );
    }

    const project: (row: unknown) => unknown =
      query.scope === "open"
        ? toOfferBrowseItem
        : query.scope === "mine"
          ? toAuthorOffer
          : toInstitutionOfferClaim;

    const source = (data ?? {}) as Record<string, unknown>;
    return NextResponse.json(
      {
        version: OFFERS_API_VERSION,
        scope: query.scope,
        items: offerListItems(source).map(project),
        meta: toOfferListMeta(source.meta, query.limit),
      },
      { status: 200, headers: headers(requestId) }
    );
  } catch (error) {
    console.error("offers_list_unavailable", {
      requestId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Offers are temporarily unavailable", requestId },
      { status: 503, headers: headers(requestId) }
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", requestId },
      { status: 400, headers: headers(requestId) }
    );
  }

  let input;
  try {
    input = parseOfferCreateInput(body);
  } catch (error) {
    if (error instanceof OfferValidationError) {
      return NextResponse.json(
        { error: "Invalid offer", issues: error.issues, requestId },
        { status: 400, headers: headers(requestId) }
      );
    }
    throw error;
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated", requestId },
        { status: 401, headers: headers(requestId) }
      );
    }

    const { data, error } = await supabaseAdmin.rpc(
      "create_donor_offer_transaction",
      offerRpcArgs(input, user.id)
    );
    if (error) {
      // The submitted point is never logged; only the failure class is.
      console.error("offer_create_failed", {
        requestId,
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        { error: "Offer could not be published", requestId },
        { status: offerErrorStatus(error.code), headers: headers(requestId) }
      );
    }

    return NextResponse.json(
      { version: OFFERS_API_VERSION, offer: toAuthorOffer(data) },
      { status: 201, headers: headers(requestId) }
    );
  } catch (error) {
    console.error("offer_create_unavailable", {
      requestId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Offer could not be published", requestId },
      { status: 503, headers: headers(requestId) }
    );
  }
}
