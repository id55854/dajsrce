import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/companies";
import { assertCompanyTierAllowsReceipts } from "@/lib/billing/gate";
import { ceilingPct, consumedPct } from "@/lib/tax";
import {
  buildReceiptManifestXml,
  renderDonationReceiptPdf,
  type ReceiptLineItem,
} from "@/lib/receipts/render";
import { writeAuditLog } from "@/lib/audit";
import { sendReceiptReadyEmail } from "@/lib/email/receipt-ready";
import type { Locale, SubscriptionTier } from "@/lib/types";

type PledgeRow = {
  id: string;
  amount_eur: number | null;
  tax_category: string;
  need: {
    title: string;
    institution: { name: string; oib: string | null } | null;
  } | null;
  pledge_acknowledgements: Array<{ kind: "manual" | "auto"; signed_at: string }> | null;
};

function fiscalYearBounds(year: number): { start: string; end: string } {
  return {
    start: `${year}-01-01T00:00:00.000Z`,
    end: `${year}-12-31T23:59:59.999Z`,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const check = await requireMembership(supabase, companyId, user?.id ?? null, [
    "owner",
    "admin",
    "finance",
  ]);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { data, error } = await supabase
    .from("donation_receipts")
    .select("*")
    .eq("company_id", companyId)
    .order("fiscal_year", { ascending: false })
    .order("version", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ receipts: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const check = await requireMembership(supabase, companyId, user.id, ["owner", "admin", "finance"]);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { data: company } = await supabase.from("companies").select("*").eq("id", companyId).single();
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const tierGate = assertCompanyTierAllowsReceipts(company.subscription_tier as SubscriptionTier);
  if (tierGate) return tierGate;

  let fiscalYear: number;
  try {
    const body = (await req.json()) as { fiscal_year?: number };
    fiscalYear = Number(body.fiscal_year);
    if (!Number.isFinite(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
      throw new Error("bad year");
    }
  } catch {
    return NextResponse.json({ error: "fiscal_year required (number)" }, { status: 400 });
  }

  const { start, end } = fiscalYearBounds(fiscalYear);

  const { data: pledgeRows, error: pErr } = await supabaseAdmin
    .from("pledges")
    .select(
      `
      id,
      amount_eur,
      tax_category,
      need:needs(
        title,
        institution:institutions(name, oib)
      ),
      pledge_acknowledgements(kind, signed_at)
    `
    )
    .eq("company_id", companyId)
    .not("amount_eur", "is", null)
    .gt("amount_eur", 0);

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  const lines: ReceiptLineItem[] = [];
  for (const row of (pledgeRows ?? []) as unknown as PledgeRow[]) {
    const acks = row.pledge_acknowledgements;
    const ack = Array.isArray(acks) && acks.length > 0 ? acks[0] : null;
    if (!ack) continue;
    const signed = new Date(ack.signed_at);
    if (signed < new Date(start) || signed > new Date(end)) continue;
    const inst = row.need?.institution;
    lines.push({
      pledgeId: row.id,
      dateIso: ack.signed_at,
      institutionName: inst?.name ?? row.need?.title ?? "Institution",
      institutionOib: inst?.oib ?? null,
      taxCategory: row.tax_category,
      amountEur: Number(row.amount_eur),
      ackKind: ack.kind,
    });
  }

  if (lines.length === 0) {
    return NextResponse.json(
      { error: "No acknowledged pledges with EUR amounts in that fiscal year." },
      { status: 400 }
    );
  }

  const totalEur = Math.round(lines.reduce((s, l) => s + l.amountEur, 0) * 100) / 100;
  const pct = ceilingPct();
  const consumed = consumedPct(totalEur, company.prior_year_revenue_eur);

  const { data: versionRow } = await supabaseAdmin
    .from("donation_receipts")
    .select("version")
    .eq("company_id", companyId)
    .eq("fiscal_year", fiscalYear)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = (versionRow?.version ?? 0) + 1;
  const generatedAt = new Date().toISOString();

  const pdfBytes = await renderDonationReceiptPdf({
    company: {
      legal_name: company.legal_name,
      oib: company.oib,
      address: company.address,
      city: company.city,
      brand_primary_hex: company.brand_primary_hex,
    },
    fiscalYear,
    ceilingPct: pct,
    consumedPct: consumed,
    lines,
    totalEur,
    version,
  });

  const xml = buildReceiptManifestXml({
    companyId,
    fiscalYear,
    version,
    generatedAtIso: generatedAt,
    ceilingPct: pct,
    consumedPct: consumed,
    totalEur,
    lines,
  });

  const basePath = `${companyId}/${fiscalYear}`;
  const pdfPath = `${basePath}/receipt-v${version}.pdf`;
  const xmlPath = `${basePath}/receipt-v${version}.xml`;

  const { error: upPdf } = await supabaseAdmin.storage
    .from("receipts")
    .upload(pdfPath, Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upPdf) {
    return NextResponse.json({ error: upPdf.message }, { status: 500 });
  }

  const { error: upXml } = await supabaseAdmin.storage
    .from("receipts")
    .upload(xmlPath, Buffer.from(xml, "utf8"), {
      contentType: "application/xml",
      upsert: true,
    });
  if (upXml) {
    return NextResponse.json({ error: upXml.message }, { status: 500 });
  }

  const { data: receipt, error: insErr } = await supabaseAdmin
    .from("donation_receipts")
    .insert({
      company_id: companyId,
      fiscal_year: fiscalYear,
      version,
      pdf_url: pdfPath,
      xml_url: xmlPath,
      total_amount_eur: totalEur,
      ceiling_pct: pct,
      ceiling_consumed_pct: consumed,
      manifest_jsonb: {
        generated_at: generatedAt,
        line_count: lines.length,
        pledge_ids: lines.map((l) => l.pledgeId),
      },
    })
    .select()
    .single();

  if (insErr || !receipt) {
    return NextResponse.json({ error: insErr?.message ?? "Insert failed" }, { status: 500 });
  }

  await writeAuditLog(supabaseAdmin, {
    actor_profile_id: user.id,
    company_id: companyId,
    action: "receipt.generate",
    entity_type: "donation_receipt",
    entity_id: receipt.id,
    payload: { fiscal_year: fiscalYear, version, total_eur: totalEur },
  });

  const { data: owner } = await supabaseAdmin
    .from("profiles")
    .select("email, locale")
    .eq("id", company.owner_id)
    .maybeSingle();

  if (owner?.email) {
    await sendReceiptReadyEmail({
      to: owner.email,
      locale: (owner.locale as Locale) === "en" ? "en" : "hr",
      companyName: company.display_name || company.legal_name,
      fiscalYear,
      totalEur,
    });
  }

  return NextResponse.json({ receipt });
}
