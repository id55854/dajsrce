/**
 * Presentation-only helpers shared by the auth surfaces.
 *
 * Nothing here changes authentication behaviour. It maps whatever Supabase (or
 * our own invite API) reports onto a *translation key*, so a Croatian user
 * never reads an English server string and a raw database message never
 * reaches the browser. Components keep the returned key in state rather than a
 * rendered string, which is what lets a mid-session locale switch re-render
 * the error in the new language.
 */

/**
 * Minimum length for *choosing* a password — sign-up and the password-reset
 * update form, which both import this constant so the number lives in one
 * place.
 *
 * Deliberately not imported by `/auth/login`: raising the floor must never
 * lock an existing account out of signing in with the password it already
 * has. Supabase's own `Auth > Providers > Email > Minimum password length`
 * setting is the server-side half of this rule and has to be raised to match;
 * until it is, GoTrue answers `weak_password`, which `authErrorKey` already
 * maps onto the same message family as the client-side rules in
 * `@/lib/password-strength`.
 */
export const MIN_PASSWORD_LENGTH = 12;

export const AUTH_NOT_CONFIGURED = "auth.error_not_configured";
export const AUTH_NETWORK_ERROR = "auth.error_network";
export const AUTH_RATE_LIMITED = "auth.error_rate_limited";
export const AUTH_NOT_AUTHENTICATED = "auth.error_not_authenticated";

/**
 * `AuthError.code` is the stable contract (auth-js ships the union in
 * `lib/error-codes`), so prefer it over the human-readable message.
 */
const CODE_KEYS: Record<string, string> = {
  invalid_credentials: "auth.error_invalid_credentials",
  email_not_confirmed: "auth.error_email_not_confirmed",
  email_exists: "auth.error_email_exists",
  user_already_exists: "auth.error_email_exists",
  identity_already_exists: "auth.error_email_exists",
  email_address_invalid: "auth.error_email_invalid",
  email_address_not_authorized: "auth.error_email_invalid",
  weak_password: "auth.error_weak_password",
  same_password: "auth.error_same_password",
  over_email_send_rate_limit: AUTH_RATE_LIMITED,
  over_request_rate_limit: AUTH_RATE_LIMITED,
  signup_disabled: "auth.error_signup_disabled",
  email_provider_disabled: "auth.error_signup_disabled",
  session_expired: AUTH_NOT_AUTHENTICATED,
  session_not_found: AUTH_NOT_AUTHENTICATED,
  user_not_found: AUTH_NOT_AUTHENTICATED,
  request_timeout: AUTH_NETWORK_ERROR,
};

/** Fallback for GoTrue deployments that answer without a machine code. */
const MESSAGE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/invalid login credentials/i, "auth.error_invalid_credentials"],
  [/email not confirmed|confirm your email/i, "auth.error_email_not_confirmed"],
  [/already registered|already exists|already been registered/i, "auth.error_email_exists"],
  [/password should be at least|password is too short/i, "auth.error_weak_password"],
  [/different from the old password|same as the old password/i, "auth.error_same_password"],
  [/unable to validate email|invalid email/i, "auth.error_email_invalid"],
  [/rate limit|too many requests|for security purposes/i, AUTH_RATE_LIMITED],
  [/signups? (are |is )?disabled|signup_disabled/i, "auth.error_signup_disabled"],
  [/failed to fetch|networkerror|load failed|timed? ?out/i, AUTH_NETWORK_ERROR],
];

/**
 * Maps an unknown thrown/returned auth failure onto a translation key. Unknown
 * failures fall back to the shared generic message rather than leaking the
 * server's own wording.
 */
export function authErrorKey(error: unknown): string {
  if (!error) return "common.error_generic";

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && CODE_KEYS[code]) return CODE_KEYS[code];
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" &&
            error !== null &&
            typeof (error as { message?: unknown }).message === "string"
          ? ((error as { message: string }).message)
          : "";

  for (const [pattern, key] of MESSAGE_PATTERNS) {
    if (pattern.test(message)) return key;
  }
  return "common.error_generic";
}

/**
 * `/api/companies/invite/accept` answers with distinct status codes per
 * failure mode (401/403/404/410/400). Translate from the status rather than
 * echoing the English body it returns.
 */
export function inviteErrorKey(status: number): string {
  if (status === 400) return "auth.invite_error_invalid_token";
  if (status === 401) return "auth.invite_error_signed_out";
  if (status === 403) return "auth.invite_error_email_mismatch";
  if (status === 404) return "auth.invite_error_not_found";
  if (status === 410) return "auth.invite_error_expired";
  return "common.error_generic";
}
