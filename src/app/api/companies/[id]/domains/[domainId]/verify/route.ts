import { NextRequest, NextResponse } from "next/server";
import { resolveTxt } from "node:dns/promises";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/companies";
import { writeAuditLog } from "@/lib/audit";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; domainId: string }> }
) {
  const { id, domainId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const check = await requireMembership(supabase, id, user?.id ?? null, ["owner", "admin"]);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { data: record } = await supabase
    .from("company_domains")
    .select("*")
    .eq("company_id", id)
    .eq("id", domainId)
    .maybeSingle();

  if (!record) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  if (record.verified_at) {
    return NextResponse.json({ verified: true, domain: record });
  }

  let txtRecords: string[][] = [];
  try {
    txtRecords = await resolveTxt(record.domain);
  } catch {
    return NextResponse.json({ verified: false, reason: "dns_lookup_failed" });
  }

  const flat = txtRecords.map((chunks) => chunks.join("")).map((s) => s.toLowerCase());
  const expected = String(record.dns_token).toLowerCase();
  const match = flat.some((entry) => entry === expected || entry.includes(expected));

  if (!match) {
    return NextResponse.json({ verified: false, reason: "record_not_found" });
  }

  const { data: updated, error } = await supabase
    .from("company_domains")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", domainId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAuditLog(supabaseAdmin, {
    actor_profile_id: user!.id,
    company_id: id,
    action: "company.domain.verify",
    entity_type: "company_domain",
    entity_id: domainId,
    payload: { domain: record.domain },
  });

  return NextResponse.json({ verified: true, domain: updated });
}
