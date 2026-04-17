import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { flags } from "@/lib/flags";
import type { PublicCompanyBundle } from "@/lib/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
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
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";

  return NextResponse.json({
    slug: bundle.company.slug,
    title: bundle.company.display_name?.trim() || bundle.company.legal_name,
    tagline: bundle.company.tagline,
    metrics: bundle.metrics,
    profile_url: `${base}/company/${bundle.company.slug}`,
  });
}
