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
  need_title: string;
  institution_name: string;
  institution_oib: string | null;
  ack_kind: "manual" | "auto";
  ack_signed_at: string;
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

  const { data: pledgeRows, error: pErr } = await supabaseAdmin.rpc(
    "get_acknowledged_pledges_json",
    { p_company_id: companyId, p_from: start, p_to: end }
  );

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  const lines: ReceiptLineItem[] = [];
  for (const row of (Array.isArray(pledgeRows) ? pledgeRows : []) as PledgeRow[]) {
    lines.push({
      pledgeId: row.id,
      dateIso: row.ack_signed_at,
      institutionName: row.institution_name || row.need_title || "Institution",
      institutionOib: row.institution_oib,
      taxCategory: row.tax_category,
      amountEur: Number(row.amount_eur),
      ackKind: row.ack_kind,
    });
  }

  if (lines.length === 0) {
    return NextResponse.json(
      { error: "No acknowledged pledges with EUR amounts in that fiscal year." },
      { status: 400 }
    );
  }

  const totalCents = lines.reduce((sum, line) => sum + Math.round(line.amountEur * 100), 0);
  const totalEur = totalCents / 100;
  const pct = ceilingPct();
  const consumed = consumedPct(totalEur, company.prior_year_revenue_eur);

  const { data: version, error: versionError } = await supabaseAdmin.rpc(
    "reserve_artifact_version",
    { p_company_id: companyId, p_artifact_kind: "receipt", p_scope_key: String(fiscalYear) }
  );
  if (versionError || typeof version !== "number") {
    return NextResponse.json({ error: "Could not reserve receipt version" }, { status: 500 });
  }
  const generatedAt = new Date().toISOString();

  const { data: receipt, error: reservationError } = await supabaseAdmin
    .from("donation_receipts")
    .insert({
      company_id: companyId,
      fiscal_year: fiscalYear,
      version,
      total_amount_eur: totalEur,
      ceiling_pct: pct,
      ceiling_consumed_pct: consumed,
      generation_status: "generating",
      manifest_jsonb: {
        generated_at: generatedAt,
        line_count: lines.length,
        pledge_ids: lines.map((line) => line.pledgeId),
      },
    })
    .select()
    .single();
  if (reservationError || !receipt) {
    return NextResponse.json({ error: "Could not create receipt generation record" }, { status: 500 });
  }

  let pdfBytes: Uint8Array;
  let xml: string;
  try {
    pdfBytes = await renderDonationReceiptPdf({
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

    xml = buildReceiptManifestXml({
      companyId,
      fiscalYear,
      version,
      generatedAtIso: generatedAt,
      ceilingPct: pct,
      consumedPct: consumed,
      totalEur,
      lines,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Receipt rendering failed";
    await supabaseAdmin
      .from("donation_receipts")
      .update({ generation_status: "failed", generation_error: message })
      .eq("id", receipt.id);
    console.error("[receipt generation] rendering failed", { receiptId: receipt.id, message });
    return NextResponse.json({ error: "Receipt rendering failed" }, { status: 500 });
  }

  const basePath = `${companyId}/${fiscalYear}/${receipt.id}`;
  const pdfPath = `${basePath}/receipt-v${version}.pdf`;
  const xmlPath = `${basePath}/receipt-v${version}.xml`;

  const { error: upPdf } = await supabaseAdmin.storage
    .from("receipts")
    .upload(pdfPath, Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upPdf) {
    await supabaseAdmin
      .from("donation_receipts")
      .update({ generation_status: "failed", generation_error: upPdf.message })
      .eq("id", receipt.id);
    return NextResponse.json({ error: upPdf.message }, { status: 500 });
  }

  const { error: upXml } = await supabaseAdmin.storage
    .from("receipts")
    .upload(xmlPath, Buffer.from(xml, "utf8"), {
      contentType: "application/xml",
      upsert: true,
    });
  if (upXml) {
    await supabaseAdmin.storage.from("receipts").remove([pdfPath]);
    await supabaseAdmin
      .from("donation_receipts")
      .update({ generation_status: "failed", generation_error: upXml.message })
      .eq("id", receipt.id);
    return NextResponse.json({ error: upXml.message }, { status: 500 });
  }

  const { data: readyReceipt, error: updateError } = await supabaseAdmin
    .from("donation_receipts")
    .update({
      pdf_url: pdfPath,
      xml_url: xmlPath,
      generation_status: "ready",
      generation_error: null,
    })
    .eq("id", receipt.id)
    .select()
    .single();

  if (updateError || !readyReceipt) {
    await supabaseAdmin.storage.from("receipts").remove([pdfPath, xmlPath]);
    await supabaseAdmin
      .from("donation_receipts")
      .update({ generation_status: "failed", generation_error: updateError?.message ?? "Publish failed" })
      .eq("id", receipt.id);
    return NextResponse.json({ error: "Receipt publication failed" }, { status: 500 });
  }

  try {
    await writeAuditLog(supabaseAdmin, {
      actor_profile_id: user.id,
      company_id: companyId,
      action: "receipt.generate",
      entity_type: "donation_receipt",
      entity_id: readyReceipt.id,
      payload: { fiscal_year: fiscalYear, version, total_eur: totalEur },
    });
  } catch {
    await supabaseAdmin.storage.from("receipts").remove([pdfPath, xmlPath]);
    await supabaseAdmin
      .from("donation_receipts")
      .update({ generation_status: "failed", generation_error: "Audit append failed" })
      .eq("id", readyReceipt.id);
    return NextResponse.json({ error: "Receipt evidence could not be finalized" }, { status: 500 });
  }

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

  return NextResponse.json({ receipt: readyReceipt });
}
