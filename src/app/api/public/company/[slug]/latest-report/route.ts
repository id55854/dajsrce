import { NextRequest, NextResponse } from "next/server";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { flags } from "@/lib/flags";
import { isValidPublicCompanySlug } from "@/lib/public-company-http";
import type { PublicCompanyBundle } from "@/lib/types";

const PUBLIC_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60, s-maxage=300",
  Vary: "Accept-Encoding",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_HEADERS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const redirect = req.nextUrl.searchParams.get("redirect") === "1";
  if (!flags.publicProfileEnabled || !isValidPublicCompanySlug(slug)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: PUBLIC_HEADERS });
  }

  const supabase = createPublicSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_company_bundle", {
    p_slug: slug,
  });

  if (error) {
    return NextResponse.json(
      { error: "Report is temporarily unavailable" },
      { status: 503, headers: { ...PUBLIC_HEADERS, "Cache-Control": "no-store" } }
    );
  }
  if (data == null) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: PUBLIC_HEADERS });
  }

  const bundle = data as unknown as PublicCompanyBundle;
  const latest = bundle.latest_report;
  if (!latest?.id) {
    return NextResponse.json({ error: "No report published" }, { status: 404, headers: PUBLIC_HEADERS });
  }

  const { data: row, error: rErr } = await supabaseAdmin
    .from("company_csr_reports")
    .select("pdf_storage_path")
    .eq("id", latest.id)
    .eq("generation_status", "ready")
    .maybeSingle();

  if (rErr) {
    return NextResponse.json(
      { error: "Report is temporarily unavailable" },
      { status: 503, headers: { ...PUBLIC_HEADERS, "Cache-Control": "no-store" } }
    );
  }
  if (!row?.pdf_storage_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: PUBLIC_HEADERS });
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from("reports")
    .createSignedUrl(row.pdf_storage_path, 900);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: signErr?.message ?? "Could not sign URL" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (redirect) {
    return NextResponse.redirect(signed.signedUrl, { status: 302, headers: PUBLIC_HEADERS });
  }

  return NextResponse.json(
    {
      url: signed.signedUrl,
      expires_in: 900,
      period_start: latest.period_start,
      period_end: latest.period_end,
      generated_at: latest.generated_at,
    },
    { headers: PUBLIC_HEADERS }
  );
}
