import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireStripe, tierForStripePriceId } from "@/lib/stripe/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SubscriptionTier } from "@/lib/types";

export const runtime = "nodejs";

type ClaimResult = { claimed?: boolean; status?: string };

async function applySubscription(
  subscription: Stripe.Subscription,
  forceDeleted = false
): Promise<void> {
  const companyId = subscription.metadata?.company_id;
  if (!companyId) {
    throw new Error(`Subscription ${subscription.id} has no company_id metadata`);
  }

  const priceId = subscription.items.data[0]?.price?.id;
  const tier = priceId ? tierForStripePriceId(priceId) : null;
  const isDeleted = forceDeleted || subscription.status === "canceled";
  const isEntitled = !isDeleted && ["active", "trialing"].includes(subscription.status);
  if (isEntitled && !tier) {
    throw new Error(`Subscription ${subscription.id} uses an unknown Stripe price`);
  }

  const customerRaw = subscription.customer;
  const customerId =
    typeof customerRaw === "string" ? customerRaw : customerRaw?.id ?? null;
  const period = subscription as unknown as {
    current_period_end?: number;
    cancel_at?: number | null;
  };
  const resolvedTier: SubscriptionTier = isEntitled && tier ? tier : "free";

  const { error: subscriptionError } = await supabaseAdmin.from("subscriptions").upsert(
    {
      company_id: companyId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      tier: resolvedTier,
      status: isDeleted ? "canceled" : subscription.status,
      current_period_end: period.current_period_end
        ? new Date(period.current_period_end * 1000).toISOString()
        : null,
      cancel_at: period.cancel_at
        ? new Date(period.cancel_at * 1000).toISOString()
        : null,
      raw: JSON.parse(JSON.stringify(subscription)) as Record<string, unknown>,
    },
    { onConflict: "company_id" }
  );
  if (subscriptionError) throw new Error(subscriptionError.message);

  const { error: companyError } = await supabaseAdmin
    .from("companies")
    .update({
      subscription_tier: resolvedTier,
      subscription_status: isEntitled ? "active" : "inactive",
    })
    .eq("id", companyId);
  if (companyError) throw new Error(companyError.message);
}

export async function POST(req: NextRequest) {
  const stripe = requireStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  const eventEnvelope = { id: event.id, type: event.type, livemode: event.livemode };
  const { data: claimData, error: claimError } = await supabaseAdmin.rpc(
    "claim_stripe_event",
    { p_event_id: event.id, p_type: event.type, p_payload: eventEnvelope }
  );
  if (claimError) {
    console.error("[stripe webhook] event claim failed", {
      eventId: event.id,
      code: claimError.code,
      message: claimError.message,
    });
    return NextResponse.json({ error: "Could not claim webhook event" }, { status: 500 });
  }

  const claim = claimData as ClaimResult | null;
  if (!claim?.claimed) {
    if (claim?.status === "succeeded") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Another worker owns a fresh processing lease. A non-2xx response keeps
    // Stripe retrying instead of permanently discarding a possibly failed run.
    return NextResponse.json({ error: "Webhook event is already processing" }, { status: 409 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (!subscriptionId) {
          throw new Error(`Checkout session ${session.id} has no subscription`);
        }
        // Retrieve the authoritative subscription and price. Checkout metadata
        // is never allowed to decide the paid entitlement.
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await applySubscription(subscription);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        await applySubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case "customer.subscription.deleted": {
        await applySubscription(event.data.object as Stripe.Subscription, true);
        break;
      }
      default:
        break;
    }

    const { error: completionError } = await supabaseAdmin.rpc("complete_stripe_event", {
      p_event_id: event.id,
      p_succeeded: true,
      p_error: null,
    });
    if (completionError) throw new Error(completionError.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook failure";
    console.error("[stripe webhook] processing failed", { eventId: event.id, message });
    const { error: failureStateError } = await supabaseAdmin.rpc("complete_stripe_event", {
      p_event_id: event.id,
      p_succeeded: false,
      p_error: message,
    });
    if (failureStateError) {
      console.error("[stripe webhook] could not persist failure state", {
        eventId: event.id,
        message: failureStateError.message,
      });
    }
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
