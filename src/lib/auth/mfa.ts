import { safeInternalPath } from "@/lib/security/redirects";

/**
 * Two-step sign-in: after the password (or Google, or an e-mail link) comes a
 * six-digit code from an authenticator app, through Supabase Auth MFA (TOTP).
 * Optional for everyone, mandatory for superadmins.
 *
 * This module is browser-safe; the server guards that turn these rules into
 * 403s live in `mfa-server.ts`. How the pieces fit is described in
 * docs/AUTH_PASSWORD_OPERATIONS.md, section 3.
 */

/** The stable error code of every request refused for a missing second step. */
export const MFA_REQUIRED_CODE = "mfa_required";

/** The code-entry page every unverified session is sent to. */
export const MFA_CHALLENGE_PATH = "/auth/mfa";

/** The settings section, where an administrator without a factor has to enrol. */
export const MFA_SETTINGS_ANCHOR = "dvostupanjska-prijava";
export const MFA_SETTINGS_HREF = `/dashboard/postavke#${MFA_SETTINGS_ANCHOR}`;

/** What the factor is called in Supabase; one factor per account. */
export const TOTP_FRIENDLY_NAME = "DajSrce";

export const TOTP_CODE_LENGTH = 6;

type FactorLike = { status?: unknown; factor_type?: unknown };

/**
 * Whether a user object lists a verified factor. Supabase raises a session to
 * `aal2` with any verified factor, so any type counts, not only TOTP.
 *
 * What that proves depends on where the object came from: from
 * `auth.getUser()` it is Supabase Auth's answer, from a stored session it is
 * whatever the cookie says.
 */
export function hasVerifiedFactor(
  user: { factors?: readonly FactorLike[] | null } | null | undefined
): boolean {
  const factors = user?.factors;
  return Array.isArray(factors) && factors.some((factor) => factor?.status === "verified");
}

/** Where to go after the code, never the code page itself. */
export function mfaNextPath(raw: string | null | undefined): string {
  const next = safeInternalPath(raw);
  return next === MFA_CHALLENGE_PATH || next.startsWith(`${MFA_CHALLENGE_PATH}?`)
    ? safeInternalPath(null)
    : next;
}

/** `/auth/mfa?next=...` for a destination that has already been decided. */
export function mfaChallengePath(next: string | null | undefined): string {
  return `${MFA_CHALLENGE_PATH}?next=${encodeURIComponent(mfaNextPath(next))}`;
}

/** Keeps what someone types or pastes ("123 456") to at most six digits. */
export function sanitizeTotpInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, TOTP_CODE_LENGTH);
}

/** The code to send, or null unless it is exactly six digits. */
export function normalizeTotpCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

type AssuranceCapableClient = {
  auth: {
    mfa: {
      getAuthenticatorAssuranceLevel: () => PromiseLike<{
        data: { currentLevel: string | null; nextLevel: string | null } | null;
        error: unknown;
      }>;
    };
  };
};

/**
 * Where a browser session goes once it exists: through the code page first
 * when the account has a factor this session has not used yet. Reads the
 * session the sign-in just stored, so it costs no request. If it cannot tell,
 * it lets the sign-in continue: the dashboard guard and every mutation route
 * still refuse an unverified session.
 */
export async function pathAfterSignIn(
  client: AssuranceCapableClient,
  next: string
): Promise<string> {
  try {
    const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.nextLevel === "aal2" && data.currentLevel !== "aal2") {
      return mfaChallengePath(next);
    }
  } catch {
    // See above: the server-side checks do not depend on this redirect.
  }
  return next;
}

/**
 * Supabase MFA failures onto translation keys, the way `authErrorKey` does it
 * for the password forms. `code` is the stable contract; the message patterns
 * cover a GoTrue that answers without one.
 */
const MFA_CODE_KEYS: Record<string, string> = {
  mfa_verification_failed: "mfa.error_code_invalid",
  mfa_verification_rejected: "mfa.error_code_invalid",
  mfa_challenge_expired: "mfa.error_code_expired",
  mfa_ip_address_mismatch: "mfa.error_code_expired",
  mfa_factor_not_found: "mfa.error_factor_missing",
  mfa_totp_enroll_not_enabled: "mfa.error_unavailable",
  mfa_totp_verify_not_enabled: "mfa.error_unavailable",
  too_many_enrolled_mfa_factors: "mfa.error_too_many_factors",
  insufficient_aal: "mfa.error_insufficient_aal",
  over_request_rate_limit: "auth.error_rate_limited",
  session_not_found: "auth.error_not_authenticated",
  session_expired: "auth.error_not_authenticated",
  request_timeout: "auth.error_network",
};

const MFA_MESSAGE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/invalid (totp )?code/i, "mfa.error_code_invalid"],
  [/challenge.*expired|expired.*challenge/i, "mfa.error_code_expired"],
  [/rate limit|too many requests/i, "auth.error_rate_limited"],
  [/session missing|not authenticated/i, "auth.error_not_authenticated"],
  [/failed to fetch|networkerror|load failed|timed? ?out/i, "auth.error_network"],
];

export function mfaErrorKey(error: unknown): string {
  if (!error || typeof error !== "object") return "mfa.error_generic";
  const { code, status, message } = error as { code?: unknown; status?: unknown; message?: unknown };
  if (typeof code === "string" && MFA_CODE_KEYS[code]) return MFA_CODE_KEYS[code];
  if (status === 429) return "auth.error_rate_limited";
  const text = typeof message === "string" ? message : "";
  for (const [pattern, key] of MFA_MESSAGE_PATTERNS) {
    if (pattern.test(text)) return key;
  }
  return "mfa.error_generic";
}
