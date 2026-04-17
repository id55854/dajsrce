import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/companies";
import { writeAuditLog } from "@/lib/audit";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; profileId: string }> }
) {
  const { id, profileId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const check = await requireMembership(supabase, id, user?.id ?? null, ["owner", "admin"]);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  if (profileId === user!.id) {
    return NextResponse.json(
      { error: "Cannot remove yourself — transfer ownership first." },
      { status: 400 }
    );
  }

  // Guard: never remove the only owner.
  const { data: target } = await supabase
    .from("company_members")
    .select("role")
    .eq("company_id", id)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (target.role === "owner") {
    return NextResponse.json(
      { error: "Owner can't be removed directly — transfer ownership first." },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("company_members")
    .delete()
    .eq("company_id", id)
    .eq("profile_id", profileId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAuditLog(supabaseAdmin, {
    actor_profile_id: user!.id,
    company_id: id,
    action: "company.member.remove",
    entity_type: "company_member",
    entity_id: profileId,
    payload: { removed_profile_id: profileId },
  });

  return NextResponse.json({ ok: true });
}
