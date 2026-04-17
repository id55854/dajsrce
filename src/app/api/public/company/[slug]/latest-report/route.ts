import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { flags } from "@/lib/flags";
import type { PublicCompanyBundle } from "@/lib/types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const redirect = req.nextUrl.searchParams.get("redirect") === "1";
  if (!flags.publicProfileEnabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_company_bundle", {
    p_slug: slug,
  });

  if (error || data == null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bundle = data as unknown as PublicCompanyBundle;
  const latest = bundle.latest_report;
  if (!latest?.id) {
    return NextResponse.json({ error: "No report published" }, { status: 404 });
  }

  const { data: row, error: rErr } = await supabaseAdmin
    .from("company_csr_reports")
    .select("pdf_storage_path")
    .eq("id", latest.id)
    .maybeSingle();

  if (rErr || !row?.pdf_storage_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from("reports")
    .createSignedUrl(row.pdf_storage_path, 900);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: signErr?.message ?? "Could not sign URL" },
      { status: 500 }
    );
  }

  if (redirect) {
    return NextResponse.redirect(signed.signedUrl, 302);
  }

  return NextResponse.json({
    url: signed.signedUrl,
    expires_in: 900,
    period_start: latest.period_start,
    period_end: latest.period_end,
    generated_at: latest.generated_at,
  });
}
