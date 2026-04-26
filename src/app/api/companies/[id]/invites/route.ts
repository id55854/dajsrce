import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { addDays, generateToken, requireMembership } from "@/lib/companies";
import { writeAuditLog } from "@/lib/audit";
import { sendCompanyInviteEmail } from "@/lib/email/invite";
import { getLocale } from "@/i18n/server";
import type { Locale } from "@/lib/types";

export async function GET(
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

  const { data, error } = await supabase
    .from("company_invites")
    .select("id, email, role, expires_at, accepted_at, created_at")
    .eq("company_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ invites: data ?? [] });
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

  let body: { emails?: unknown; role?: "admin" | "finance" | "employee" };
  try {
    body = (await req.json()) as { emails?: unknown; role?: "admin" | "finance" | "employee" };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const emails = Array.isArray(body.emails)
    ? body.emails.filter((e): e is string => typeof e === "string")
    : typeof body.emails === "string"
    ? body.emails.split(/[,\s]+/)
    : [];
  const normalized = emails
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e));

  if (normalized.length === 0) {
    return NextResponse.json({ error: "At least one valid email required" }, { status: 400 });
  }

  const role = body.role && ["admin", "finance", "employee"].includes(body.role) ? body.role : "employee";
  const expiresAt = addDays(14).toISOString();

  const rows = normalized.map((email) => ({
    company_id: id,
    email,
    role,
    token: generateToken(24),
    expires_at: expiresAt,
    invited_by: user!.id,
  }));

  const { data, error } = await supabase
    .from("company_invites")
    .insert(rows)
    .select("id, email, role, token, expires_at, created_at");

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  await writeAuditLog(supabaseAdmin, {
    actor_profile_id: user!.id,
    company_id: id,
    action: "company.invite.create",
    entity_type: "company_invite",
    entity_id: null,
    payload: { emails: normalized, role },
  });

  const invites = data.map((row) => ({
    ...row,
    accept_url: buildAcceptUrl(row.token),
  }));

  // Look up company display name + inviter display name once for the emails.
  const [{ data: company }, { data: inviterProfile }] = await Promise.all([
    supabaseAdmin
      .from("companies")
      .select("legal_name, display_name")
      .eq("id", id)
      .maybeSingle(),
    supabaseAdmin
      .from("profiles")
      .select("name, email")
      .eq("id", user!.id)
      .maybeSingle(),
  ]);
  const companyName =
    (company?.display_name as string | null) ?? (company?.legal_name as string | null) ?? "DajSrce";
  const inviterName =
    (inviterProfile?.name as string | null) ?? (inviterProfile?.email as string | null) ?? "A teammate";
  const locale: Locale = await getLocale();

  // Fire-and-forget the emails. Capture per-invite outcome so the dashboard
  // can show a "delivered" state, but don't fail the whole request if one
  // address bounces — the row + accept_url are still created.
  const emailResults = await Promise.all(
    invites.map(async (inv) => {
      const result = await sendCompanyInviteEmail({
        to: inv.email,
        locale,
        companyName,
        inviterName,
        role: inv.role,
        acceptUrl: inv.accept_url,
        expiresAt: inv.expires_at,
      });
      if (!result.sent) {
        console.warn(
          `Invite email not sent for ${inv.email}: ${result.error ?? "unknown error"}`
        );
      }
      return { id: inv.id, email: inv.email, ...result };
    })
  );

  return NextResponse.json({ invites, email_results: emailResults }, { status: 201 });
}

function buildAcceptUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}/auth/invite?token=${encodeURIComponent(token)}`;
}
