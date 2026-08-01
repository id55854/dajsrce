import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashBearerToken } from "@/lib/security/runtime";

type AcceptedInvite = {
  invite_id: string;
  company_id: string;
  member_role: string;
  invited_email: string;
};

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!user.email || !user.email_confirmed_at) {
    return NextResponse.json(
      { error: "Verify the invited email address before accepting this invitation" },
      { status: 403 }
    );
  }

  let body: { token?: unknown };
  try {
    body = (await req.json()) as { token?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    return NextResponse.json({ error: "Invalid invitation token" }, { status: 400 });
  }

  // Auth signup normally creates this row. Keep the recovery path least
  // privileged: auth is authoritative for email and no role is accepted here.
  const { error: profileError } = await supabaseAdmin.from("profiles").upsert(
    {
      id: user.id,
      email: user.email.toLowerCase(),
      name:
        (user.user_metadata?.name as string | undefined) ??
        user.email.split("@")[0] ??
        "User",
    },
    { onConflict: "id" }
  );
  if (profileError) {
    return NextResponse.json({ error: "Could not initialize profile" }, { status: 500 });
  }

  // The database function locks and consumes the invite in the same
  // transaction as membership insertion, and binds it to auth.users.email.
  const { data, error } = await supabase
    .rpc("accept_company_invite", { p_token_hash: hashBearerToken(token) })
    .single();

  if (error || !data) {
    const message = error?.message.toLowerCase() ?? "invite could not be accepted";
    const status = message.includes("not found")
      ? 404
      : message.includes("expired") || message.includes("already used")
        ? 410
        : message.includes("email") || message.includes("authenticated")
          ? 403
          : 500;
    return NextResponse.json(
      { error: status === 500 ? "Invite could not be accepted" : error?.message },
      { status }
    );
  }

  const accepted = data as AcceptedInvite;
  return NextResponse.json({
    company_id: accepted.company_id,
    role: accepted.member_role,
  });
}
