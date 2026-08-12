import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashBearerToken } from "@/lib/security/runtime";
import { getRequestId, logError } from "@/lib/observability";
import { getLocale } from "@/i18n/server";
import type { Locale } from "@/lib/types";
import {
  CLAIM_EMAIL_TOKEN_BYTES,
  CLAIM_EMAIL_TOKEN_TTL_HOURS,
  claimErrorStatus,
} from "@/lib/institution-claims";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const DEFAULT_FROM = "DajSrce <notifications@resend.dev>";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendChallengeEmail(input: {
  to: string;
  locale: Locale;
  organisationName: string;
  applicantName: string;
  confirmUrl: string;
  expiresAt: string;
}): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, error: "RESEND_API_KEY not set" };

  const expiresHuman = new Date(input.expiresAt).toLocaleString(
    input.locale === "hr" ? "hr-HR" : "en-GB",
    { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }
  );
  const organisation = escapeHtml(input.organisationName.replace(/[\r\n]+/g, " ").trim());
  const applicant = escapeHtml(input.applicantName.replace(/[\r\n]+/g, " ").trim());
  const url = escapeHtml(input.confirmUrl);

  const subject =
    input.locale === "hr"
      ? `Potvrdite zahtjev za upravljanje udrugom — ${organisation}`
      : `Confirm the request to manage — ${organisation}`;

  const bodyHr = `
    <p>Pozdrav,</p>
    <p><strong>${applicant}</strong> traži pravo upravljanja profilom udruge <strong>${organisation}</strong> na platformi DajSrce.</p>
    <p>Ova poruka poslana je na adresu koju za tu udrugu objavljuje službeni Registar udruga. Ako prepoznajete zahtjev, potvrdite da kontrolirate ovu adresu:</p>
    <p><a href="${url}" style="display:inline-block;background:#10b981;color:#fff;padding:12px 22px;border-radius:9999px;text-decoration:none;font-weight:600">Potvrdi e-mail adresu</a></p>
    <p style="font-size:12px;color:#6b7280">Poveznica vrijedi do <strong>${expiresHuman}</strong> i može se iskoristiti samo jednom.</p>
    <p style="font-size:12px;color:#6b7280">Potvrda e-maila ne odobrava zahtjev — svaki zahtjev pregledava administrator DajSrca.</p>
    <p style="font-size:12px;color:#6b7280">Ako ne prepoznajete ovaj zahtjev, zanemarite poruku i ništa se neće dogoditi.</p>
    <p>— DajSrce</p>
  `;
  const bodyEn = `
    <p>Hello,</p>
    <p><strong>${applicant}</strong> is requesting permission to manage the profile of <strong>${organisation}</strong> on DajSrce.</p>
    <p>This message was sent to the address the official Associations Register publishes for that organisation. If you recognise the request, confirm you control this mailbox:</p>
    <p><a href="${url}" style="display:inline-block;background:#10b981;color:#fff;padding:12px 22px;border-radius:9999px;text-decoration:none;font-weight:600">Confirm email address</a></p>
    <p style="font-size:12px;color:#6b7280">This link is valid until <strong>${expiresHuman}</strong> and can be used once.</p>
    <p style="font-size:12px;color:#6b7280">Confirming the email does not approve the request — every request is reviewed by a DajSrce administrator.</p>
    <p style="font-size:12px;color:#6b7280">If you do not recognise this request, ignore this message and nothing will happen.</p>
    <p>— DajSrce</p>
  `;

  const { error } = await new Resend(key).emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM,
    to: input.to,
    subject,
    html: input.locale === "hr" ? bodyHr : bodyEn,
  });
  return error ? { sent: false, error: error.message } : { sent: true };
}

/**
 * Start the mailbox challenge. The raw token exists only in this request and
 * in the email body; the database receives its SHA-256 digest and nothing
 * else. The RPC refuses any address the official register does not publish.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(req.headers);
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Not authenticated", request_id: requestId },
      { status: 401, headers: NO_STORE }
    );
  }

  const token = randomBytes(CLAIM_EMAIL_TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(
    Date.now() + CLAIM_EMAIL_TOKEN_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabaseAdmin.rpc(
    "start_institution_claim_email_verification",
    {
      p_actor_id: user.id,
      p_claim_id: id,
      p_token_hash: hashBearerToken(token),
      p_expires_at: expiresAt,
    }
  );

  if (error) {
    logError("institution_claim.email_start_failed", error, {
      request_id: requestId,
      code: error.code ?? null,
    });
    return NextResponse.json(
      { error: "The verification email could not be started", request_id: requestId },
      { status: claimErrorStatus(error.code), headers: NO_STORE }
    );
  }

  const claim = (data ?? {}) as { contact_email?: string };
  const [{ data: profile }, { data: claimRow }] = await Promise.all([
    supabaseAdmin.from("profiles").select("name, email").eq("id", user.id).maybeSingle(),
    supabaseAdmin
      .from("institution_claims")
      .select("udr_id")
      .eq("id", id)
      .maybeSingle(),
  ]);

  let organisationName = claimRow?.udr_id ?? "";
  if (claimRow?.udr_id) {
    const { data: entry } = await supabaseAdmin.rpc("get_association_registry_entry_v1", {
      p_udr_id: claimRow.udr_id,
    });
    const name = (entry as { name?: string } | null)?.name;
    if (typeof name === "string" && name.length > 0) organisationName = name;
  }

  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const locale: Locale = await getLocale();
  const emailResult = await sendChallengeEmail({
    to: claim.contact_email ?? "",
    locale,
    organisationName,
    applicantName: profile?.name ?? profile?.email ?? "A DajSrce account",
    confirmUrl: `${base}/auth/setup?claim_token=${encodeURIComponent(token)}`,
    expiresAt,
  });

  if (!emailResult.sent) {
    // The digest is already stored, so the operator can resend; never log the
    // raw token or treat a delivery failure as verification.
    logError("institution_claim.email_send_failed", new Error(emailResult.error ?? "unknown"), {
      request_id: requestId,
      claim_id: id,
    });
  }

  return NextResponse.json(
    { claim: data, email_sent: emailResult.sent, request_id: requestId },
    { headers: { ...NO_STORE, "x-request-id": requestId } }
  );
}
