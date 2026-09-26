import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashBearerToken } from "@/lib/security/runtime";
import { isUuid, jsonError, rateLimit, requireSameOrigin } from "@/lib/security/http";
import { getRequestId, logError } from "@/lib/observability";
import { getLocale } from "@/i18n/server";
import { requireEnvironmentVariable } from "@/lib/env";
import type { Locale } from "@/lib/types";
import {
  CLAIM_EMAIL_TOKEN_BYTES,
  CLAIM_EMAIL_TOKEN_TTL_HOURS,
  claimErrorCode,
  claimErrorStatus,
} from "@/lib/institution-claims";
import { buildClaimChallengeEmail, claimEmailSender } from "@/lib/institution-claim-email";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

type StartedChallenge = {
  /** The address the official register publishes; the only possible recipient. */
  registry_email?: string | null;
  /** Older schema versions return the register address here instead. */
  contact_email?: string | null;
};

async function sendChallengeEmail(input: {
  to: string;
  locale: Locale;
  organisationName: string;
  applicantName: string | null;
  confirmUrl: string;
  expiresAt: string;
}): Promise<{ sent: boolean; error?: string }> {
  const sender = claimEmailSender();
  if (!sender) return { sent: false, error: "resend_not_configured" };

  const message = buildClaimChallengeEmail(input);
  const { error } = await new Resend(sender.apiKey).emails.send({
    from: sender.from,
    to: input.to,
    ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  return error ? { sent: false, error: "delivery_failed" } : { sent: true };
}

/**
 * Start the mailbox challenge. The raw token exists only in this request and
 * in the email body; the database receives its SHA-256 digest and nothing
 * else. The RPC answers with the address the official register publishes,
 * and that is where the link goes: the applicant's typed contact address is
 * never a recipient, so the challenge proves control of the register's own
 * mailbox and nothing weaker.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(req.headers);
  const { id } = await params;
  if (!isUuid(id)) {
    return jsonError("Invalid claim id", 400, requestId, NO_STORE);
  }
  const blocked =
    requireSameOrigin(req, requestId) ??
    rateLimit(req, { name: "institution_claims.verify_email", limit: 5, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

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

  const claimLimited = rateLimit(
    req,
    {
      name: "institution_claims.verify_email.claim",
      limit: 3,
      windowMs: 15 * 60_000,
      identifier: `${user.id}:${id}`,
    },
    requestId
  );
  if (claimLimited) return claimLimited;

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
    const code = claimErrorCode(error);
    return NextResponse.json(
      {
        error: "The verification email could not be started",
        ...(code ? { code } : {}),
        request_id: requestId,
      },
      { status: claimErrorStatus(error.code), headers: NO_STORE }
    );
  }

  const started = (data ?? {}) as StartedChallenge;
  const recipient = started.registry_email?.trim() || started.contact_email?.trim() || null;

  let emailResult: { sent: boolean; error?: string } = {
    sent: false,
    error: "no_registry_email",
  };
  if (recipient) {
    try {
      const [{ data: profile }, { data: claimRow }] = await Promise.all([
        supabaseAdmin.from("profiles").select("name").eq("id", user.id).maybeSingle(),
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

      const appOrigin = new URL(requireEnvironmentVariable("NEXT_PUBLIC_APP_URL")).origin;
      const locale: Locale = await getLocale();
      emailResult = await sendChallengeEmail({
        to: recipient,
        locale,
        organisationName,
        applicantName: profile?.name ?? null,
        // Keep the raw bearer token in the fragment. Fragments are not sent in
        // HTTP requests or Referer headers, and the setup page removes it before
        // making the confirmation request.
        confirmUrl: `${appOrigin}/auth/setup#claim_token=${encodeURIComponent(token)}`,
        expiresAt,
      });
    } catch {
      emailResult = { sent: false, error: "delivery_failed" };
    }
  }

  if (!emailResult.sent) {
    // The digest is already stored, so the applicant can ask again once the
    // sender works; never log the raw token or treat a delivery failure as
    // verification.
    logError("institution_claim.email_send_failed", new Error(emailResult.error ?? "unknown"), {
      request_id: requestId,
      claim_id: id,
      reason: emailResult.error ?? null,
    });
  }

  return NextResponse.json(
    { claim: data, email_sent: emailResult.sent, request_id: requestId },
    { headers: { ...NO_STORE, "x-request-id": requestId } }
  );
}
