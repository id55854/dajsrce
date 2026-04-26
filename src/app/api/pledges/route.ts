import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";

export async function GET(_req: NextRequest) {
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ pledges: [] });
    }

    const { data, error } = await supabase
      .from("pledges")
      .select("*, need:needs(*, institution:institutions(id, name, category))")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ pledges: data ?? [] });
  } catch {
    return NextResponse.json({ pledges: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (!existingProfile) {
      await supabase.from("profiles").insert({
        id: user.id,
        email: user.email!,
        name: user.user_metadata?.name || user.email!.split("@")[0],
        role: user.user_metadata?.role || "individual",
      });
    }

    const body = await req.json();
    const {
      need_id,
      quantity,
      message,
      company_id,
      campaign_id,
      request_match,
      tax_category,
      amount_eur,
    } = body as {
      need_id?: string;
      quantity?: number;
      message?: string;
      company_id?: string | null;
      campaign_id?: string | null;
      request_match?: boolean;
      tax_category?: string;
      amount_eur?: number | null;
    };
    const qty = quantity || 1;

    if (!need_id) {
      return NextResponse.json({ error: "need_id is required" }, { status: 400 });
    }

    // If the caller claims a company, enforce that they're a member of it.
    let resolvedCompanyId: string | null = null;
    let resolvedCampaignId: string | null = null;
    let matchRatio = 0;
    if (company_id) {
      const { data: membership } = await supabase
        .from("company_members")
        .select("role, company:companies(id, default_match_ratio)")
        .eq("company_id", company_id)
        .eq("profile_id", user.id)
        .maybeSingle();
      if (!membership) {
        return NextResponse.json({ error: "Not a member of this company" }, { status: 403 });
      }
      resolvedCompanyId = company_id;
      const companyRow = membership.company as { default_match_ratio?: number } | null;
      matchRatio = Number(companyRow?.default_match_ratio ?? 0);

      if (campaign_id) {
        const { data: camp } = await supabase
          .from("campaigns")
          .select("id, company_id")
          .eq("id", campaign_id)
          .maybeSingle();
        if (!camp || camp.company_id !== company_id) {
          return NextResponse.json({ error: "Campaign not found for this company" }, { status: 400 });
        }
        resolvedCampaignId = campaign_id;
      }
    }

    const amt =
      typeof amount_eur === "number" && Number.isFinite(amount_eur) && amount_eur >= 0
        ? Math.round(amount_eur * 100) / 100
        : null;

    const { data, error } = await supabase
      .from("pledges")
      .insert({
        user_id: user.id,
        need_id,
        quantity: qty,
        message: message || null,
        status: "pledged",
        company_id: resolvedCompanyId,
        campaign_id: resolvedCampaignId,
        tax_category: tax_category || "humanitarian",
        amount_eur: amt,
      })
      .select()
      .single();

    if (error) throw error;

    // Request a match: insert a mirrored pledge attributed to the company.
    let matchPledgeId: string | null = null;
    if (request_match && resolvedCompanyId && matchRatio > 0) {
      const matchQty = Math.max(1, Math.round(qty * matchRatio));
      const { data: matchPledge } = await supabaseAdmin
        .from("pledges")
        .insert({
          user_id: user.id, // Attribution lives on company_id; donor column kept for FK.
          need_id,
          quantity: matchQty,
          message: `Match of ${qty} by company`,
          status: "pledged",
          company_id: resolvedCompanyId,
          campaign_id: resolvedCampaignId,
          match_of_pledge_id: data.id,
          tax_category: tax_category || "humanitarian",
          amount_eur: amt != null ? Math.round(amt * Number(matchRatio) * 100) / 100 : null,
        })
        .select()
        .single();
      matchPledgeId = matchPledge?.id ?? null;
    }

    const totalQty = qty + (matchPledgeId ? Math.max(1, Math.round(qty * matchRatio)) : 0);

    const { data: need } = await supabase
      .from("needs")
      .select("quantity_pledged")
      .eq("id", need_id)
      .single();

    const newQuantityPledged = need
      ? (need.quantity_pledged || 0) + totalQty
      : null;

    if (need) {
      await supabase
        .from("needs")
        .update({ quantity_pledged: newQuantityPledged })
        .eq("id", need_id);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("total_pledges")
      .eq("id", user.id)
      .single();

    if (profile) {
      await supabase
        .from("profiles")
        .update({ total_pledges: (profile.total_pledges || 0) + 1 })
        .eq("id", user.id);
    }

    if (resolvedCompanyId) {
      await writeAuditLog(supabaseAdmin, {
        actor_profile_id: user.id,
        company_id: resolvedCompanyId,
        action: "pledge.create",
        entity_type: "pledge",
        entity_id: data.id,
        payload: {
          need_id,
          quantity: qty,
          campaign_id: resolvedCampaignId,
          match_pledge_id: matchPledgeId,
        },
      });
    }

    return NextResponse.json({
      pledge: data,
      match_pledge_id: matchPledgeId,
      // Lets clients patch their local needs[] state without a refetch.
      need:
        newQuantityPledged !== null
          ? { id: need_id, quantity_pledged: newQuantityPledged }
          : null,
    });
  } catch (e) {
    // Surface the underlying DB error so failures don't get masked behind a
    // generic 500. The actual message (e.g. "infinite recursion detected in
    // policy for relation profiles") is the user's only signal that a
    // migration is missing or RLS is misconfigured.
    const msg = e instanceof Error ? e.message : "Failed to create pledge";
    console.error("[/api/pledges POST] failed:", msg, e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
