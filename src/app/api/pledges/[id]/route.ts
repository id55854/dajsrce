import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type PledgeRow = {
  id: string;
  user_id: string;
  need_id: string;
  status: string;
};

async function loadPledge(pledgeId: string): Promise<PledgeRow | null> {
  const { data } = await supabaseAdmin
    .from("pledges")
    .select("id, user_id, need_id, status")
    .eq("id", pledgeId)
    .maybeSingle();
  return data;
}

async function canInstitutionActOnPledge(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  needId: string
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("institution_id, role")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.institution_id || profile.role !== "ngo") return false;
  const { data: need } = await supabase
    .from("needs")
    .select("institution_id")
    .eq("id", needId)
    .maybeSingle();
  return need?.institution_id === profile.institution_id;
}

/** Donor or recipient NGO marks a pledge as physically delivered. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: pledgeId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { status?: string };
  try {
    body = (await req.json()) as { status?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.status !== "delivered") {
    return NextResponse.json({ error: "Only status=delivered is supported" }, { status: 400 });
  }

  const pledge = await loadPledge(pledgeId);
  if (!pledge) {
    return NextResponse.json({ error: "Pledge not found" }, { status: 404 });
  }
  if (pledge.status !== "pledged") {
    return NextResponse.json({ error: "Pledge is not in pledged status" }, { status: 409 });
  }

  const isDonor = pledge.user_id === user.id;
  const isNgo = await canInstitutionActOnPledge(supabase, user.id, pledge.need_id);
  if (!isDonor && !isNgo) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const deliveredAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("pledges")
    .update({ status: "delivered", delivered_at: deliveredAt })
    .eq("id", pledgeId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, delivered_at: deliveredAt });
}
