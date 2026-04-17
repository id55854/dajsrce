import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/companies";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; receiptId: string }> }
) {
  const { id: companyId, receiptId } = await params;
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") === "xml" ? "xml" : "pdf";

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

  const { data: receipt, error } = await supabaseAdmin
    .from("donation_receipts")
    .select("id, pdf_url, xml_url, company_id")
    .eq("id", receiptId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  const storagePath = format === "xml" ? receipt.xml_url : receipt.pdf_url;
  if (!storagePath) {
    return NextResponse.json({ error: "File missing" }, { status: 404 });
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from("receipts")
    .createSignedUrl(storagePath, 120);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: signErr?.message ?? "Could not sign URL" }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl, expires_in: 120 });
}
