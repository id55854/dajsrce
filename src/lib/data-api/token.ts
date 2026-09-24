/**
 * Short-lived tokens for the Neon Data API. Server-only: this module reads the
 * private signing key and must never be imported from client code.
 *
 * Supabase Auth still owns identity, but Neon cannot verify Supabase's anon or
 * service keys and never sees an anonymous Supabase token. So the app is the
 * issuer: once a Supabase session has been verified, it signs an ES256 token
 * that Neon checks against `public/.well-known/jwks.json`. The role claim picks
 * the Postgres role, exactly as Supabase's PostgREST did:
 *
 * - `anon` for public reads (the stateless public client);
 * - `authenticated` with `sub` = the Supabase user id, so `auth.uid()` and
 *   every RLS policy keep working unchanged;
 * - `service_role` (BYPASSRLS) for the server-only admin client and scripts.
 *
 * `authenticator` is a member of only these three roles, so a token cannot
 * reach anything else. WebCrypto keeps this usable from middleware too.
 */

export const DATA_API_AUDIENCE = "dajsrce-data-api";
export const DATA_API_ISSUER = "dajsrce";

/** Long enough to cover a request, short enough that a leaked token is stale. */
const TOKEN_LIFETIME_SECONDS = 10 * 60;
/** A cached token is replaced this long before it expires. */
const REFRESH_MARGIN_SECONDS = 60;

export type DataApiRole = "anon" | "authenticated" | "service_role";

export type DataApiIdentity = {
  id: string;
  email: string | null;
  /** Display hint only, used to seed a new profile's name. Never authorization. */
  name?: string | null;
};

type SigningKey = { key: CryptoKey; kid: string };

let signingKey: Promise<SigningKey> | null = null;
const cached: Partial<Record<"anon" | "service_role", { token: string; exp: number }>> = {};

function loadSigningKey(): Promise<SigningKey> {
  signingKey ??= (async () => {
    const raw = process.env.DATA_API_JWT_PRIVATE_JWK?.trim();
    if (!raw) throw new Error("Missing environment variable: DATA_API_JWT_PRIVATE_JWK");
    const jwk = JSON.parse(raw) as JsonWebKey & { kid?: string };
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.kid) {
      throw new Error("DATA_API_JWT_PRIVATE_JWK must be a private P-256 JWK with a kid");
    }
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
    return { key, kid: jwk.kid };
  })();
  // A bad key must not be cached as a permanent rejection.
  signingKey.catch(() => {
    signingKey = null;
  });
  return signingKey;
}

function base64Url(input: string | ArrayBuffer): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(claims: Record<string, unknown>): Promise<{ token: string; exp: number }> {
  const { key, kid } = await loadSigningKey();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_LIFETIME_SECONDS;
  const header = base64Url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const payload = base64Url(
    JSON.stringify({ ...claims, iss: DATA_API_ISSUER, aud: DATA_API_AUDIENCE, iat, exp })
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return { token: `${header}.${payload}.${base64Url(signature)}`, exp };
}

async function sharedToken(role: "anon" | "service_role"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const hit = cached[role];
  if (hit && hit.exp - REFRESH_MARGIN_SECONDS > now) return hit.token;
  const minted = await sign({ role });
  cached[role] = minted;
  return minted.token;
}

export function anonDataApiToken(): Promise<string> {
  return sharedToken("anon");
}

export function serviceDataApiToken(): Promise<string> {
  return sharedToken("service_role");
}

/**
 * A token for one verified Supabase user. Callers must have verified the
 * Supabase session first (`getVerifiedClaims` or `auth.getUser()`); the
 * identity passed here is trusted as-is.
 */
export async function userDataApiToken(identity: DataApiIdentity): Promise<{ token: string; exp: number }> {
  return sign({
    role: "authenticated",
    sub: identity.id,
    email: identity.email ?? undefined,
    user_metadata: identity.name ? { name: identity.name } : undefined,
  });
}

/** Test hook: forget the cached key and shared tokens. */
export function resetDataApiTokenCache() {
  signingKey = null;
  delete cached.anon;
  delete cached.service_role;
}
