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

function parseISODate(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return raw;
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

  const reportId = randomUUID();
  const pdfPath = `${companyId}/${reportId}.pdf`;
  const docxPath = `${companyId}/${reportId}.docx`;

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

  if (upPdf.error) {
    return NextResponse.json({ error: upPdf.error.message }, { status: 500 });
  }
  if (upDocx.error) {
    return NextResponse.json({ error: upDocx.error.message }, { status: 500 });
  }

  const { data: row, error: insErr } = await supabaseAdmin
    .from("company_csr_reports")
    .insert({
      id: reportId,
      company_id: companyId,
      period_start: periodStart,
      period_end: periodEnd,
      pdf_storage_path: pdfPath,
      docx_storage_path: docxPath,
      generated_by: user.id,
      manifest_jsonb: manifest as unknown as Record<string, unknown>,
    })
    .select()
    .single();

  if (insErr || !row) {
    return NextResponse.json({ error: insErr?.message ?? "Insert failed" }, { status: 500 });
  }

  await writeAuditLog(supabaseAdmin, {
    actor_profile_id: user.id,
    company_id: companyId,
    action: "csr_report.generate",
    entity_type: "company_csr_report",
    entity_id: reportId,
    payload: { period_start: periodStart, period_end: periodEnd },
  });

  return NextResponse.json({ report: row }, { status: 201 });
}
