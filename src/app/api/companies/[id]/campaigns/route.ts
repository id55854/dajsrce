import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireMembership, slugify } from "@/lib/companies";
import { writeAuditLog } from "@/lib/audit";

type CreateCampaignBody = {
  name?: string;
  description?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  target_amount_eur?: number;
  sdg_tags?: number[];
  theme?: string;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const check = await requireMembership(supabase, id, user?.id ?? null);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("company_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ campaigns: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const check = await requireMembership(supabase, id, user?.id ?? null, ["owner", "admin"]);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  let body: CreateCampaignBody;
  try {
    body = (await req.json()) as CreateCampaignBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const baseSlug = slugify(name);
  const slug = await ensureUniqueCampaignSlug(supabase, id, baseSlug);

  const row = {
    company_id: id,
    name,
    slug,
    description: body.description ?? null,
    starts_at: body.starts_at ?? null,
    ends_at: body.ends_at ?? null,
    target_amount_eur: body.target_amount_eur ?? null,
    sdg_tags: Array.isArray(body.sdg_tags) ? body.sdg_tags.filter((n) => Number.isInteger(n) && n >= 1 && n <= 17) : [],
    theme: body.theme ?? null,
  };

  const { data, error } = await supabase.from("campaigns").insert(row).select().single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  await writeAuditLog(supabaseAdmin, {
    actor_profile_id: user!.id,
    company_id: id,
    action: "campaign.create",
    entity_type: "campaign",
    entity_id: data.id,
    payload: { name, slug },
  });

  return NextResponse.json({ campaign: data }, { status: 201 });
}

async function ensureUniqueCampaignSlug(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  companyId: string,
  base: string
): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data } = await supabase
      .from("campaigns")
      .select("id")
      .eq("company_id", companyId)
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
