import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/companies";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; exportId: string }> }
) {
  const { id: companyId, exportId } = await params;

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

  const { data: row, error } = await supabaseAdmin
    .from("esg_exports")
    .select("id, file_url, company_id")
    .eq("id", exportId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !row?.file_url) {
    return NextResponse.json({ error: "Export not found" }, { status: 404 });
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from("exports")
    .createSignedUrl(row.file_url, 300);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: signErr?.message ?? "Could not sign URL" }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl, expires_in: 300 });
}
