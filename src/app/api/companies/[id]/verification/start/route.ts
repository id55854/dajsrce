import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { addDays, generateToken, requireMembership } from "@/lib/companies";
import { writeAuditLog } from "@/lib/audit";
import { isValidOib } from "@/lib/oib";
import {
  lookupCompany,
  SudregError,
  SudregNotFoundError,
  SudregRateLimitError,
} from "@/lib/sudreg/client";
import { sendCompanyVerificationEmail } from "@/lib/email/verify-company";
import { getLocale } from "@/i18n/server";
import type { Locale } from "@/lib/types";

const TOKEN_TTL_DAYS = 1;

// Re-fetches SudReg authoritatively (so we don't trust client-supplied
// snapshots), persists a verification row, and emails a confirmation link.
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

  let body: { oib?: unknown; contact_email?: unknown };
  try {
    body = (await req.json()) as { oib?: unknown; contact_email?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const oib = typeof body.oib === "string" ? body.oib.replace(/\s+/g, "") : "";
  if (!isValidOib(oib)) {
    return NextResponse.json({ error: "OIB has an invalid format or checksum" }, { status: 400 });
  }
  const contactEmail =
    typeof body.contact_email === "string" ? body.contact_email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail)) {
    return NextResponse.json({ error: "Contact email is not valid" }, { status: 400 });
  }

  // Authoritative SudReg fetch (don't trust the snapshot the client renders).
  let snapshot;
  try {
    snapshot = await lookupCompany(oib);
  } catch (e) {
    if (e instanceof SudregNotFoundError) {
      return NextResponse.json({ error: "OIB nije pronađen u Sudskom registru" }, { status: 404 });
    }
    if (e instanceof SudregRateLimitError) {
      return NextResponse.json(
        { error: "SudReg rate limit reached. Wait a minute and retry." },
        { status: 429 }
      );
    }
    if (e instanceof SudregError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  // Clear any prior in-flight (un-confirmed) verification for this company —
  // the unique partial index allows only one. Doing this via supabaseAdmin so
  // RLS doesn't matter; we already proved ownership above.
  await supabaseAdmin
    .from("company_verifications")
    .delete()
    .eq("company_id", id)
    .is("confirmed_at", null);

  const token = generateToken(32);
  const expiresAt = addDays(TOKEN_TTL_DAYS).toISOString();

  const { data: row, error: insertErr } = await supabaseAdmin
    .from("company_verifications")
    .insert({
      company_id: id,
      sudreg_legal_name: snapshot.legalName,
      sudreg_short_name: snapshot.shortName,
      sudreg_address: snapshot.street,
      sudreg_city: snapshot.city,
      sudreg_legal_form: snapshot.legalForm,
      sudreg_status: snapshot.status,
      sudreg_mb: snapshot.mb,
      sudreg_mbs: snapshot.mbs,
      sudreg_oib: snapshot.oib,
      sudreg_fetched_at: snapshot.fetchedAt,
      contact_email: contactEmail,
      token,
      expires_at: expiresAt,
      created_by: user!.id,
    })
    .select(
      "id, company_id, sudreg_legal_name, sudreg_short_name, sudreg_address, sudreg_city, sudreg_legal_form, sudreg_status, sudreg_mb, sudreg_mbs, sudreg_oib, sudreg_fetched_at, contact_email, expires_at, confirmed_at, created_by, created_at"
    )
    .single();

  if (insertErr || !row) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to start verification" },
      { status: 500 }
    );
  }

  // Pull the company name + the initiator for the email body.
  const [{ data: company }, { data: profile }] = await Promise.all([
    supabaseAdmin
      .from("companies")
      .select("legal_name, display_name")
      .eq("id", id)
      .maybeSingle(),
    supabaseAdmin.from("profiles").select("name, email").eq("id", user!.id).maybeSingle(),
  ]);
  const companyName =
    (company?.display_name as string | null) ?? (company?.legal_name as string | null) ?? snapshot.legalName;
  const initiatorName =
    (profile?.name as string | null) ?? (profile?.email as string | null) ?? "A teammate";
  const locale: Locale = await getLocale();

  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const confirmUrl = `${base}/verify-company?token=${encodeURIComponent(token)}`;

  const emailResult = await sendCompanyVerificationEmail({
    to: contactEmail,
    locale,
    companyName,
    legalName: snapshot.legalName,
    initiatorName,
    confirmUrl,
    expiresAt,
  });
  if (!emailResult.sent) {
    console.warn(
      `[verification/start] email not sent to ${contactEmail}: ${emailResult.error ?? "unknown"}`
    );
  }

  await writeAuditLog(supabaseAdmin, {
    actor_profile_id: user!.id,
    company_id: id,
    action: "company.verification.start",
    entity_type: "company_verification",
    entity_id: row.id,
    payload: {
      oib: snapshot.oib,
      contact_email: contactEmail,
      sudreg_status: snapshot.status,
      email_sent: emailResult.sent,
    },
  });

  return NextResponse.json(
    { verification: row, email_sent: emailResult.sent },
    { status: 201 }
  );
}
