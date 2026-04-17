import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { isValidOib, lookupOib } from "@/lib/oib";
import { slugify } from "@/lib/companies";

type CreateCompanyBody = {
  legal_name?: string;
  display_name?: string;
  oib?: string;
  address?: string;
  city?: string;
  country?: string;
  logo_url?: string;
  brand_primary_hex?: string;
  brand_secondary_hex?: string;
  size_class?: "micro" | "small" | "medium" | "large";
  csrd_wave?: 1 | 2 | 3;
  prior_year_revenue_eur?: number;
  default_match_ratio?: number;
};

// GET /api/companies — list companies the caller is a member of.
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ companies: [] });
  }

  const { data: memberships, error } = await supabase
    .from("company_members")
    .select("role, company:companies(*)")
    .eq("profile_id", user.id)
    .order("joined_at", { ascending: true });

  if (error) {
    return NextResponse.json({ companies: [], error: error.message }, { status: 500 });
  }
  const companies = (memberships ?? []).map((m) => {
    const company = m.company as unknown as Record<string, unknown>;
    return {
      ...company,
      member_role: m.role,
    };
  });
  return NextResponse.json({ companies });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: CreateCompanyBody;
  try {
    body = (await req.json()) as CreateCompanyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const legalName = body.legal_name?.trim();
  if (!legalName) {
    return NextResponse.json({ error: "legal_name is required" }, { status: 400 });
  }

  const oib = body.oib?.trim();
  if (oib && !isValidOib(oib)) {
    return NextResponse.json({ error: "OIB failed checksum" }, { status: 400 });
  }

  let registryHit: Awaited<ReturnType<typeof lookupOib>> = null;
  if (oib) {
    registryHit = await lookupOib(oib);
  }

  // Ensure the profile row exists before inserting a company — the trigger
  // should have created it, but we defensively upsert as other routes do.
  await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        email: user.email ?? "",
        name:
          (user.user_metadata?.name as string | undefined) ??
          user.email?.split("@")[0] ??
          "User",
        role: "company",
      },
      { onConflict: "id" }
    );

  const baseSlug = slugify(body.display_name || legalName);
  const slug = await ensureUniqueSlug(supabase, baseSlug);

  const insertRow = {
    owner_id: user.id,
    legal_name: registryHit?.legalName ?? legalName,
    display_name: body.display_name?.trim() || null,
    slug,
    oib: oib ?? null,
    address: body.address ?? registryHit?.address ?? null,
    city: body.city ?? registryHit?.city ?? null,
    country: (body.country || "HR").toUpperCase().slice(0, 2),
    logo_url: body.logo_url ?? null,
    brand_primary_hex: body.brand_primary_hex ?? null,
    brand_secondary_hex: body.brand_secondary_hex ?? null,
    size_class: body.size_class ?? null,
    csrd_wave: body.csrd_wave ?? null,
    prior_year_revenue_eur: body.prior_year_revenue_eur ?? null,
    default_match_ratio: body.default_match_ratio ?? 0,
  };

  const { data: company, error: insertError } = await supabase
    .from("companies")
    .insert(insertRow)
    .select()
    .single();

  if (insertError || !company) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create company" },
      { status: 500 }
    );
  }

  const { error: memberError } = await supabase.from("company_members").insert({
    company_id: company.id,
    profile_id: user.id,
    role: "owner",
  });

  if (memberError) {
    // Roll back on member insert failure so we don't leak an ownerless
    // company into the tenant list.
    await supabase.from("companies").delete().eq("id", company.id);
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  await writeAuditLog(supabaseAdmin, {
    actor_profile_id: user.id,
    company_id: company.id,
    action: "company.create",
    entity_type: "company",
    entity_id: company.id,
    payload: { legal_name: insertRow.legal_name, oib: insertRow.oib ?? null, slug },
  });

  return NextResponse.json({ company, registry_hit: Boolean(registryHit) }, { status: 201 });
}

async function ensureUniqueSlug(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  base: string
): Promise<string> {
  let candidate = base;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const suffixed = attempt === 0 ? base : `${base}-${attempt + 1}`;
    candidate = suffixed;
    const { data } = await supabase
      .from("companies")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  // As a last resort append a short random segment.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
