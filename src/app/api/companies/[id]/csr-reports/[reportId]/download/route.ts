import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/companies";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> }
) {
  const { id: companyId, reportId } = await params;
  const format = req.nextUrl.searchParams.get("format") === "docx" ? "docx" : "pdf";

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
    .from("company_csr_reports")
    .select("id, company_id, pdf_storage_path, docx_storage_path")
    .eq("id", reportId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const path =
    format === "docx" ? row.docx_storage_path : row.pdf_storage_path;
  if (!path) {
    return NextResponse.json({ error: "File not available" }, { status: 404 });
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from("reports")
    .createSignedUrl(path, 900);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: signErr?.message ?? "Could not sign URL" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: signed.signedUrl, expires_in: 900, format });
}
