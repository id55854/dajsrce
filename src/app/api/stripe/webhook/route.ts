import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireStripe, tierForStripePriceId } from "@/lib/stripe/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SubscriptionTier } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const stripe = requireStripe();
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!whSecret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET not set" }, { status: 500 });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, whSecret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { error: insErr } = await supabaseAdmin.from("stripe_events").insert({
    id: event.id,
    type: event.type,
    payload: { id: event.id, type: event.type, livemode: event.livemode },
  });

  if (insErr?.code === "23505") {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        const companyId = session.metadata?.company_id;
        const tierMeta = session.metadata?.tier as SubscriptionTier | undefined;
        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (companyId && customerId && subId) {
          await supabaseAdmin.from("subscriptions").upsert(
            {
              company_id: companyId,
              stripe_customer_id: customerId,
              stripe_subscription_id: subId,
              tier: tierMeta ?? null,
              status: "active",
              raw: JSON.parse(JSON.stringify(session)) as Record<string, unknown>,
            },
            { onConflict: "company_id" }
          );
          if (tierMeta) {
            await supabaseAdmin
              .from("companies")
              .update({ subscription_tier: tierMeta, subscription_status: "active" })
              .eq("id", companyId);
          }
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const subTimes = sub as unknown as {
          current_period_end?: number;
          cancel_at?: number | null;
        };
        const companyId = sub.metadata?.company_id;
        if (!companyId) break;

        const priceId = sub.items.data[0]?.price?.id;
        const tierFromPrice = priceId ? tierForStripePriceId(priceId) : null;
        const tierMeta = sub.metadata?.tier as SubscriptionTier | undefined;
        const resolvedTier: SubscriptionTier =
          tierFromPrice ?? tierMeta ?? ("free" as SubscriptionTier);

        const customerRaw = sub.customer;
        const customerId =
          typeof customerRaw === "string" ? customerRaw : customerRaw?.id ?? null;

        if (event.type === "customer.subscription.deleted") {
          await supabaseAdmin
            .from("subscriptions")
            .upsert(
              {
                company_id: companyId,
                stripe_customer_id: customerId,
                stripe_subscription_id: sub.id,
                tier: "free",
                status: "canceled",
                current_period_end: null,
                cancel_at: null,
                raw: JSON.parse(JSON.stringify(sub)) as Record<string, unknown>,
              },
              { onConflict: "company_id" }
            );
          await supabaseAdmin
            .from("companies")
            .update({ subscription_tier: "free", subscription_status: "inactive" })
            .eq("id", companyId);
        } else {
          await supabaseAdmin.from("subscriptions").upsert(
            {
              company_id: companyId,
              stripe_customer_id: customerId,
              stripe_subscription_id: sub.id,
              tier: resolvedTier,
              status: sub.status,
              current_period_end: subTimes.current_period_end
                ? new Date(subTimes.current_period_end * 1000).toISOString()
                : null,
              cancel_at: subTimes.cancel_at
                ? new Date(subTimes.cancel_at * 1000).toISOString()
                : null,
              raw: JSON.parse(JSON.stringify(sub)) as Record<string, unknown>,
            },
            { onConflict: "company_id" }
          );
          const active = sub.status === "active" || sub.status === "trialing";
          await supabaseAdmin
            .from("companies")
            .update({
              subscription_tier: active ? resolvedTier : "free",
              subscription_status: active ? "active" : "inactive",
            })
            .eq("id", companyId);
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("stripe webhook handler error", e);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
