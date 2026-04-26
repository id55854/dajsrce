import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/companies";

const PUBLIC_FIELDS =
  "id, company_id, sudreg_legal_name, sudreg_short_name, sudreg_address, sudreg_city, sudreg_legal_form, sudreg_status, sudreg_mb, sudreg_mbs, sudreg_oib, sudreg_fetched_at, contact_email, expires_at, confirmed_at, created_by, created_at";

// GET — returns the latest verification (pending or confirmed) for a company,
// plus the company's own verified_at stamp so the UI can collapse states.
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

  const [{ data: verification }, { data: company }] = await Promise.all([
    supabase
      .from("company_verifications")
      .select(PUBLIC_FIELDS)
      .eq("company_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("companies").select("verified_at").eq("id", id).maybeSingle(),
  ]);

  return NextResponse.json({
    verification: verification ?? null,
    company_verified_at: company?.verified_at ?? null,
  });
}

// DELETE — cancel a pending verification (only useful if the user wants to
// switch the contact email). Confirmed rows are kept as audit trail.
export async function DELETE(
  _req: NextRequest,
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

  const { error } = await supabaseAdmin
    .from("company_verifications")
    .delete()
    .eq("company_id", id)
    .is("confirmed_at", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
