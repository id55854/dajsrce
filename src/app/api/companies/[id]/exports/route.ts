import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/companies";
import { assertCompanyTierAllowsFramework } from "@/lib/billing/gate";
import { compileFramework } from "@/lib/frameworks/compile";
import { buildEsgExportZip } from "@/lib/exports/pack";
import { writeAuditLog } from "@/lib/audit";
import type { Framework, SubscriptionTier } from "@/lib/types";

const FRAMEWORKS: Framework[] = [
  "vsme_basic",
  "vsme_comp",
  "esrs_s1",
  "esrs_s3",
  "gri_413",
  "b4si",
];

function parseFramework(raw: unknown): Framework | null {
  if (typeof raw !== "string") return null;
  return FRAMEWORKS.includes(raw as Framework) ? (raw as Framework) : null;
}

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

  const { data, error } = await supabase
    .from("esg_exports")
    .select("*")
    .eq("company_id", companyId)
    .order("generated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ exports: data ?? [] });
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

  let body: { framework?: unknown; period_start?: unknown; period_end?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const framework = parseFramework(body.framework);
  if (!framework) {
    return NextResponse.json({ error: "Invalid framework" }, { status: 400 });
  }

  const periodStart = parseISODate(body.period_start);
  const periodEnd = parseISODate(body.period_end);
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    return NextResponse.json(
      { error: "period_start and period_end required as YYYY-MM-DD (start ≤ end)" },
      { status: 400 }
    );
  }

  const tierGate = assertCompanyTierAllowsFramework(
    company.subscription_tier as SubscriptionTier,
    framework
  );
  if (tierGate) return tierGate;

  const results = await compileFramework(supabaseAdmin, companyId, framework, {
    periodStart,
    periodEnd,
  });

  const { zipBytes, manifest } = await buildEsgExportZip({
    companyName: company.legal_name,
    framework,
    periodStart,
    periodEnd,
    results,
  });

  const { data: versionRow } = await supabaseAdmin
    .from("esg_exports")
    .select("version")
    .eq("company_id", companyId)
    .eq("framework", framework)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = (versionRow?.version ?? 0) + 1;
  const exportId = randomUUID();
  const storagePath = `${companyId}/${exportId}.zip`;

  const { error: upErr } = await supabaseAdmin.storage
    .from("exports")
    .upload(storagePath, Buffer.from(zipBytes), {
      contentType: "application/zip",
      upsert: true,
    });

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const { data: row, error: insErr } = await supabaseAdmin
    .from("esg_exports")
    .insert({
      id: exportId,
      company_id: companyId,
      framework,
      period_start: periodStart,
      period_end: periodEnd,
      file_url: storagePath,
      manifest_jsonb: manifest as Record<string, unknown>,
      version,
    })
    .select()
    .single();

  if (insErr || !row) {
    return NextResponse.json({ error: insErr?.message ?? "Insert failed" }, { status: 500 });
  }

  await writeAuditLog(supabaseAdmin, {
    actor_profile_id: user.id,
    company_id: companyId,
    action: "esg_export.generate",
    entity_type: "esg_export",
    entity_id: exportId,
    payload: { framework, period_start: periodStart, period_end: periodEnd, version },
  });

  return NextResponse.json({ export: row }, { status: 201 });
}
