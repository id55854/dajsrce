import { NextResponse } from "next/server";
import { getVerifiedClaims, type AssuranceLevel } from "@/lib/auth/claims";
import { MFA_REQUIRED_CODE, hasVerifiedFactor } from "@/lib/auth/mfa";
import { NO_STORE, withRequestId } from "@/lib/security/http";

/**
 * Server-side two-step sign-in rules.
 *
 * Two facts decide everything, and they come from different places:
 *
 * - the session's assurance level (`aal`) is a claim in the signed access
 *   token, verified locally like every other read of it (`getVerifiedClaims`);
 * - whether the account HAS a factor is not in the token at all. Supabase
 *   Auth answers it in `auth.getUser()`, which every mutation route already
 *   calls, so the guards below take that user object and add no request. The
 *   copy of the factor list inside the session cookie is only good enough to
 *   route a navigation (`sessionListsVerifiedFactor`); its holder can edit it.
 */

type ClaimsCapableClient = Parameters<typeof getVerifiedClaims>[0];

/** The user object `auth.getUser()` returned, with Supabase's factor list. */
type AuthenticatedUser = {
  id: string;
  factors?: readonly { status?: unknown }[] | null;
};

async function sessionIsAal2(supabase: ClaimsCapableClient, userId: string): Promise<boolean> {
  const claims = await getVerifiedClaims(supabase);
  return claims?.id === userId && claims.aal === "aal2";
}

/**
 * True when the account has a verified factor that this session has not
 * used: the password (or Google, or an e-mail link) was not the whole sign-in.
 * Free for an account without a factor; otherwise one local JWT verification.
 */
export async function secondFactorPending(
  supabase: ClaimsCapableClient,
  user: AuthenticatedUser
): Promise<boolean> {
  if (!hasVerifiedFactor(user)) return false;
  return !(await sessionIsAal2(supabase, user.id));
}

export function mfaRequiredResponse(requestId?: string): NextResponse {
  return NextResponse.json(
    {
      error: "Two-step sign-in required",
      code: MFA_REQUIRED_CODE,
      ...(requestId ? { request_id: requestId } : {}),
    },
    { status: 403, headers: withRequestId(NO_STORE, requestId) }
  );
}

/**
 * Every route that authenticates with `auth.getUser()` calls this right after
 * it: an account with a factor cannot act on an `aal1` session. Returns the
 * 403 to send, or null to carry on.
 */
export async function requireSecondFactorIfEnrolled(
  supabase: ClaimsCapableClient,
  user: AuthenticatedUser,
  requestId?: string
): Promise<NextResponse | null> {
  return (await secondFactorPending(supabase, user)) ? mfaRequiredResponse(requestId) : null;
}

/**
 * Administrator routes: two-step sign-in is mandatory, so the account must
 * have a verified factor (per Supabase Auth, not per the cookie) and this
 * session must have used one. An administrator who has not enrolled gets the
 * same 403 and is sent to the settings page to do it. Checking the factor as
 * well as the claim also ends a session whose factor was just removed, which
 * would otherwise keep an `aal2` token until it expires.
 */
export async function requireSecondFactor(
  supabase: ClaimsCapableClient,
  user: AuthenticatedUser,
  requestId?: string
): Promise<NextResponse | null> {
  if (hasVerifiedFactor(user) && (await sessionIsAal2(supabase, user.id))) return null;
  return mfaRequiredResponse(requestId);
}

type SessionCapableClient = {
  auth: {
    getSession: () => PromiseLike<{
      data: { session: { user?: unknown } | null };
      error?: unknown;
    }>;
  };
};

/**
 * Whether the session stored in this request's cookies lists a verified
 * factor. For the paths where calling Supabase Auth on every request is not
 * acceptable (the dashboard guard, the admin layout, the read-only routes):
 * the list is Supabase's answer from the last sign-in or token refresh, but
 * the cookie holder can edit it. What it cannot fake is the `aal` claim, so
 * nothing that only an `aal2` session may do rests on this: administrator
 * pages require the claim outright, and mutations and Data API tokens re-read
 * the factor list from `auth.getUser()`.
 *
 * Read through the property descriptor on purpose. On the server auth-js
 * wraps a stored session's user in a proxy that logs "could be insecure" on
 * the first property access, which here would be once per dashboard request;
 * the warning is right, and this comment is its answer.
 */
export async function sessionListsVerifiedFactor(supabase: SessionCapableClient): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user || typeof user !== "object") return false;
    const factors: unknown = Object.getOwnPropertyDescriptor(user, "factors")?.value;
    return hasVerifiedFactor({ factors: Array.isArray(factors) ? factors : null });
  } catch {
    return false;
  }
}

/**
 * Read-only routes verify the JWT locally and must not call Supabase Auth on
 * every request, so they cannot ask whether the account has a factor. They go
 * by the session cookie's list, exactly like the dashboard guard: an `aal1`
 * session whose cookie lists a verified factor reads nothing of the account's
 * until the code has been entered. That keeps the navbar bell quiet on the
 * code page itself (an organisation's notifications name its donors) and the
 * dashboard's data with the dashboard. Routing-grade for the reason given
 * above: the holder of the cookie can edit the list.
 */
export async function readerNeedsSecondFactor(
  supabase: SessionCapableClient,
  claims: { aal?: AssuranceLevel }
): Promise<boolean> {
  return claims.aal !== "aal2" && (await sessionListsVerifiedFactor(supabase));
}
