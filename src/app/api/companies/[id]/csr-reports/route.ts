import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/companies";
import { assertCompanyTierAllowsCsrReport } from "@/lib/billing/gate";
import { writeAuditLog } from "@/lib/audit";
import { gatherCsrReportManifest } from "@/lib/csr-report/gather";
import { renderCsrReportPdf } from "@/lib/csr-report/render-pdf";
import { renderCsrReportDocx } from "@/lib/csr-report/render-docx";
import type { SubscriptionTier } from "@/lib/types";
import { parseISODate } from "@/lib/dates";

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

  const { data: companyRow, error: coErr } = await supabase
    .from("companies")
    .select("subscription_tier")
    .eq("id", companyId)
    .maybeSingle();

  if (coErr || !companyRow) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const tierGate = assertCompanyTierAllowsCsrReport(companyRow.subscription_tier as SubscriptionTier);
  if (tierGate) return tierGate;

  const { data, error } = await supabase
    .from("company_csr_reports")
    .select("*")
    .eq("company_id", companyId)
    .order("generated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reports: data ?? [] });
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

  const { data: company, error: coErr } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .single();

  if (coErr || !company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const tierGate = assertCompanyTierAllowsCsrReport(company.subscription_tier as SubscriptionTier);
  if (tierGate) return tierGate;

  let body: { period_start?: unknown; period_end?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const periodStart = parseISODate(body.period_start);
  const periodEnd = parseISODate(body.period_end);
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    return NextResponse.json(
      { error: "period_start and period_end required as YYYY-MM-DD (start ≤ end)" },
      { status: 400 }
    );
  }

  const manifest = await gatherCsrReportManifest(
    supabaseAdmin,
    companyId,
    periodStart,
    periodEnd,
    {
      legal_name: company.legal_name,
      display_name: company.display_name,
      tagline: company.tagline,
      brand_primary_hex: company.brand_primary_hex,
    }
  );

  const pdfBytes = await renderCsrReportPdf(manifest);
  const docxBuf = await renderCsrReportDocx(manifest);

  const scopeKey = `${periodStart}:${periodEnd}`;
  const { data: version, error: versionError } = await supabaseAdmin.rpc(
    "reserve_artifact_version",
    { p_company_id: companyId, p_artifact_kind: "csr_report", p_scope_key: scopeKey }
  );
  if (versionError || typeof version !== "number") {
    return NextResponse.json({ error: "Could not reserve report version" }, { status: 500 });
  }
  const reportId = randomUUID();
  const pdfPath = `${companyId}/${reportId}.pdf`;
  const docxPath = `${companyId}/${reportId}.docx`;

  const { error: reservationError } = await supabaseAdmin.from("company_csr_reports").insert({
    id: reportId,
    company_id: companyId,
    period_start: periodStart,
    period_end: periodEnd,
    generated_by: user.id,
    manifest_jsonb: manifest as unknown as Record<string, unknown>,
    version,
    generation_status: "generating",
  });
  if (reservationError) {
    return NextResponse.json({ error: "Could not create report generation record" }, { status: 500 });
  }

  const [upPdf, upDocx] = await Promise.all([
    supabaseAdmin.storage.from("reports").upload(pdfPath, Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      upsert: true,
    }),
    supabaseAdmin.storage.from("reports").upload(docxPath, docxBuf, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    }),
  ]);

  if (upPdf.error || upDocx.error) {
    await supabaseAdmin.storage.from("reports").remove([pdfPath, docxPath]);
    const message = upPdf.error?.message ?? upDocx.error?.message ?? "Upload failed";
    await supabaseAdmin
      .from("company_csr_reports")
      .update({ generation_status: "failed", generation_error: message })
      .eq("id", reportId);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data: row, error: insErr } = await supabaseAdmin
    .from("company_csr_reports")
    .update({
      pdf_storage_path: pdfPath,
      docx_storage_path: docxPath,
      generation_status: "ready",
      generation_error: null,
    })
    .eq("id", reportId)
    .select()
    .single();

  if (insErr || !row) {
    await supabaseAdmin.storage.from("reports").remove([pdfPath, docxPath]);
    await supabaseAdmin
      .from("company_csr_reports")
      .update({ generation_status: "failed", generation_error: insErr?.message ?? "Publish failed" })
      .eq("id", reportId);
    return NextResponse.json({ error: "Report publication failed" }, { status: 500 });
  }

  try {
    await writeAuditLog(supabaseAdmin, {
      actor_profile_id: user.id,
      company_id: companyId,
      action: "csr_report.generate",
      entity_type: "company_csr_report",
      entity_id: reportId,
      payload: { period_start: periodStart, period_end: periodEnd, version },
    });
  } catch {
    await supabaseAdmin.storage.from("reports").remove([pdfPath, docxPath]);
    await supabaseAdmin
      .from("company_csr_reports")
      .update({ generation_status: "failed", generation_error: "Audit append failed" })
      .eq("id", reportId);
    return NextResponse.json({ error: "Report evidence could not be finalized" }, { status: 500 });
  }

  return NextResponse.json({ report: row }, { status: 201 });
}
