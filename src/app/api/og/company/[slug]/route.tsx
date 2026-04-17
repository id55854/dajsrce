import { ImageResponse } from "next/og";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { flags } from "@/lib/flags";
import type { PublicCompanyBundle } from "@/lib/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  if (!flags.publicProfileEnabled) {
    return new Response("Not found", { status: 404 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_company_bundle", {
    p_slug: slug,
  });

  if (error || data == null) {
    return new Response("Not found", { status: 404 });
  }

  const bundle = data as unknown as PublicCompanyBundle;
  const title = bundle.company.display_name?.trim() || bundle.company.legal_name;
  const accent = bundle.company.brand_primary_hex?.replace("#", "") ?? "EF4444";
  const given = bundle.metrics.total_given_eur ?? 0;
  const fmt = new Intl.NumberFormat("hr-HR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number(given));

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          background: "#0f172a",
          padding: 48,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: `#${accent}`,
            }}
          />
          <span style={{ fontSize: 28, color: "white", fontWeight: 700 }}>{title}</span>
        </div>
        <div style={{ fontSize: 52, color: "white", fontWeight: 800 }}>{fmt}</div>
        <div style={{ fontSize: 22, color: "#94a3b8", marginTop: 12 }}>
          acknowledged giving (public profile)
        </div>
        <div style={{ fontSize: 18, color: "#64748b", marginTop: 32 }}>DajSrce</div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
