import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { flags } from "@/lib/flags";
import { isValidPublicCompanySlug, publicAppOrigin } from "@/lib/public-company-http";
import type { PublicCompanyBundle } from "@/lib/types";

const PUBLIC_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
  Vary: "Accept-Encoding",
  "X-Dajsrce-Api-Version": "1",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_HEADERS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!flags.publicProfileEnabled || !isValidPublicCompanySlug(slug)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: PUBLIC_HEADERS });
  }

  const supabase = createPublicSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_company_bundle", {
    p_slug: slug,
  });

  if (error) {
    return NextResponse.json(
      { error: "Company card is temporarily unavailable" },
      { status: 503, headers: { ...PUBLIC_HEADERS, "Cache-Control": "no-store" } }
    );
  }
  if (data == null) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: PUBLIC_HEADERS });
  }

  const bundle = data as unknown as PublicCompanyBundle;
  const body = JSON.stringify({
      slug: bundle.company.slug,
      title: bundle.company.display_name?.trim() || bundle.company.legal_name,
      tagline: bundle.company.tagline,
      metrics: bundle.metrics,
      profile_url: `${publicAppOrigin(req)}/company/${bundle.company.slug}`,
  });
  const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
  const headers = { ...PUBLIC_HEADERS, ETag: etag };
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(body, {
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}
