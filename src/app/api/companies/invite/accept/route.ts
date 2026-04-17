import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { token?: string };
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  // Invite lookup must bypass RLS because the invitee isn't a member yet.
  const { data: invite, error } = await supabaseAdmin
    .from("company_invites")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error || !invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  if (invite.accepted_at) {
    return NextResponse.json({ error: "Invite already used" }, { status: 410 });
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }

  // Ensure a profile row exists for the caller.
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
      },
      { onConflict: "id" }
    );

  // Insert membership. If the caller is already a member, surface that as 200.
  const { data: existingMember } = await supabaseAdmin
    .from("company_members")
    .select("id")
    .eq("company_id", invite.company_id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!existingMember) {
    const { error: memberError } = await supabaseAdmin.from("company_members").insert({
      company_id: invite.company_id,
      profile_id: user.id,
      role: invite.role,
    });
    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }
  }

  await supabaseAdmin
    .from("company_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  await writeAuditLog(supabaseAdmin, {
    actor_profile_id: user.id,
    company_id: invite.company_id,
    action: "company.invite.accept",
    entity_type: "company_invite",
    entity_id: invite.id,
    payload: { email: invite.email, role: invite.role },
  });

  return NextResponse.json({ company_id: invite.company_id, role: invite.role });
}
