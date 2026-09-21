/**
 * Cheap identity for routine, read-only paths.
 *
 * `auth.getUser()` is an HTTP round trip to Supabase Auth on every call. This
 * project signs access tokens with an asymmetric key (ES256, verified live on
 * 2026-09-06), so `auth.getClaims()` can validate the JWT locally against the
 * project's JWKS, which auth-js caches process-wide for ten minutes. On a
 * symmetric-key project the same call transparently falls back to `getUser()`,
 * so nothing here weakens verification: a forged or expired token is rejected
 * either way.
 *
 * The trade-off is revocation latency: a session signed out or banned
 * elsewhere stays valid here until the token expires (one hour). That is
 * acceptable for navigation guards and "who am I" reads. It is NOT acceptable
 * for anything that changes state or grants access, so every mutation, claim
 * review and token issuance keeps calling `auth.getUser()`.
 */

type ClaimsCapableClient = {
  auth: {
    getClaims: (...args: never[]) => PromiseLike<{
      data: { claims: Record<string, unknown> } | null;
      error: unknown;
    }>;
  };
};

export type VerifiedClaims = {
  id: string;
  email: string | null;
  /** Signup intent and display hints only. Never a source of authorization. */
  userMetadata: Record<string, unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getVerifiedClaims(
  supabase: ClaimsCapableClient
): Promise<VerifiedClaims | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return null;
    const claims = data.claims;
    const sub = typeof claims.sub === "string" ? claims.sub : null;
    if (!sub || !UUID.test(sub)) return null;
    // Anonymous sign-ins are not enabled for this project; refuse them
    // explicitly so a future toggle cannot turn them into profile reads.
    if (claims.is_anonymous === true) return null;
    return {
      id: sub,
      email: typeof claims.email === "string" ? claims.email : null,
      userMetadata:
        claims.user_metadata && typeof claims.user_metadata === "object"
          ? (claims.user_metadata as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}
