import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("institution_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.institution_id || profile.role !== "ngo") {
    return NextResponse.json({ error: "Institution access only" }, { status: 403 });
  }

  const { data: needs } = await supabase
    .from("needs")
    .select("id")
    .eq("institution_id", profile.institution_id);

  const needIds = (needs ?? []).map((n) => n.id);
  if (needIds.length === 0) {
    return NextResponse.json({ pledges: [] });
  }

  const { data: pledges, error } = await supabase
    .from("pledges")
    .select(
      `
      id,
      user_id,
      need_id,
      quantity,
      status,
      amount_eur,
      delivered_at,
      tax_category,
      created_at,
      company_id,
      need:needs(title),
      pledge_acknowledgements(id, kind, signed_at, notes)
    `
    )
    .in("need_id", needIds)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ pledges: pledges ?? [] });
}
