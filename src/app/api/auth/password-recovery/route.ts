import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendPasswordRecovery } from "@/lib/auth/password-recovery-server";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, jsonError, requireSameOrigin } from "@/lib/security/http";
import { rateLimitDurable } from "@/lib/security/rate-limit-durable";

export const dynamic = "force-dynamic";

const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

function emailBucket(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

/**
 * Request a one-use password recovery link without revealing account
 * existence. Supabase applies its provider limit too; these limits stop this
 * application from becoming a convenient email-abuse relay.
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked =
    requireSameOrigin(req, requestId) ??
    (await rateLimitDurable(
      req,
      { name: "auth.password_recovery.ip", limit: 5, windowMs: 15 * 60_000 },
      requestId
    ));
  if (blocked) return blocked;

  let body: { email?: unknown };
  try {
    body = (await req.json()) as { email?: unknown };
  } catch {
    return jsonError("Invalid JSON", 400, requestId, NO_STORE);
  }

  const email = parseEmail(body.email);
  if (!email) return jsonError("Email is invalid", 400, requestId, NO_STORE);

  const emailLimited = await rateLimitDurable(
    req,
    {
      name: "auth.password_recovery.email",
      limit: 3,
      windowMs: 15 * 60_000,
      identifier: emailBucket(email),
    },
    requestId
  );
  if (emailLimited) return emailLimited;

  try {
    const { error } = await sendPasswordRecovery(email);
    if (error) {
      // Preserve account privacy: Auth can report different internal causes
      // for registered and unregistered addresses. The client always receives
      // the same accepted response.
      logError("auth.password_recovery_send_failed", error, {
        request_id: requestId,
        code: error.code ?? null,
      });
    }
  } catch (error) {
    logError("auth.password_recovery_unavailable", error, { request_id: requestId });
    return jsonError("Password recovery is temporarily unavailable", 503, requestId, NO_STORE);
  }

  return NextResponse.json(
    { accepted: true, request_id: requestId },
    { status: 202, headers: { ...NO_STORE, "x-request-id": requestId } }
  );
}
