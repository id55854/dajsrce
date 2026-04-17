import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
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
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .maybeSingle();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: profile?.email ?? undefined,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard/company/settings?cid=${companyId}&billing=success`,
    cancel_url: `${appUrl}/dashboard/company/settings?cid=${companyId}&billing=cancel`,
    metadata: { company_id: companyId, tier },
    subscription_data: {
      metadata: { company_id: companyId, tier },
    },
  });

  if (!session.url) {
    return NextResponse.json({ error: "No checkout URL" }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}
