import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/companies";
import { writeAuditLog } from "@/lib/audit";
import type { SubscriptionTier } from "@/lib/types";

const ALLOWED: SubscriptionTier[] = ["free", "sme_tax", "sme_plus", "enterprise"];

/**
 * Demo-only: set company subscription_tier without Stripe.
 * Enable with ALLOW_DEMO_BILLING=true (never in production).
 */
export async function POST(req: NextRequest) {
  if (process.env.ALLOW_DEMO_BILLING !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { company_id?: string; tier?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const companyId = body.company_id;
  const tier = body.tier as SubscriptionTier | undefined;
  if (!companyId || !tier || !ALLOWED.includes(tier)) {
    return NextResponse.json(
      { error: "company_id and tier (free|sme_tax|sme_plus|enterprise) required" },
      { status: 400 }
    );
  }

  const check = await requireMembership(supabase, companyId, user.id, ["owner", "admin"]);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const status = tier === "free" ? "inactive" : "active";

  const { error } = await supabaseAdmin
    .from("companies")
    .update({ subscription_tier: tier, subscription_status: status })
    .eq("id", companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAuditLog(supabaseAdmin, {
    actor_profile_id: user.id,
    company_id: companyId,
    action: "demo.apply_tier",
    entity_type: "company",
    entity_id: companyId,
    payload: { tier, subscription_status: status },
  });

  return NextResponse.json({ ok: true, tier, subscription_status: status });
}
