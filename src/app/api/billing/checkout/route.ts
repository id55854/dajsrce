import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/companies";
import { getStripe, priceIdForPaidTier } from "@/lib/stripe/server";
import type { SubscriptionTier } from "@/lib/types";

function isPaidTier(t: SubscriptionTier): t is Exclude<SubscriptionTier, "free"> {
  return t !== "free";
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 501 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let companyId: string;
  let tier: SubscriptionTier;
  try {
    const body = (await req.json()) as { company_id?: string; tier?: SubscriptionTier };
    if (!body.company_id || !body.tier || !isPaidTier(body.tier)) {
      return NextResponse.json(
        { error: "company_id and a paid tier (sme_tax, sme_plus, enterprise) required" },
        { status: 400 }
      );
    }
    companyId = body.company_id;
    tier = body.tier;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const check = await requireMembership(supabase, companyId, user.id, ["owner", "admin"]);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const priceId = priceIdForPaidTier(tier);
  if (!priceId) {
    return NextResponse.json(
      { error: "Stripe price env not set for this tier" },
      { status: 500 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const [{ data: profile }, { data: existingSubscription }] = await Promise.all([
    supabase.from("profiles").select("email").eq("id", user.id).maybeSingle(),
    supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, status")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);

  if (
    existingSubscription?.stripe_subscription_id &&
    ["active", "trialing", "past_due", "incomplete", "unpaid"].includes(
      existingSubscription.status ?? ""
    )
  ) {
    return NextResponse.json(
      { error: "An active or pending subscription already exists; use billing management" },
      { status: 409 }
    );
  }

  const hourBucket = Math.floor(Date.now() / 3_600_000);
  const idempotencyKey = createHash("sha256")
    .update(`${companyId}|${tier}|${hourBucket}`)
    .digest("hex");
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: existingSubscription?.stripe_customer_id ?? undefined,
      customer_email: existingSubscription?.stripe_customer_id
        ? undefined
        : profile?.email ?? undefined,
      client_reference_id: companyId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard/company/settings?cid=${companyId}&billing=success`,
      cancel_url: `${appUrl}/dashboard/company/settings?cid=${companyId}&billing=cancel`,
      metadata: { company_id: companyId },
      subscription_data: {
        metadata: { company_id: companyId },
      },
    },
    { idempotencyKey }
  );

  if (!session.url) {
    return NextResponse.json({ error: "No checkout URL" }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}
