import { getVerifiedClaims, type VerifiedClaims } from "@/lib/auth/claims";
import { getDataApiUrl } from "@/lib/data-api/fetch";
import { anonDataApiToken, userDataApiToken } from "@/lib/data-api/token";

/**
 * Server-side token resolution for a request that may carry a Supabase
 * session. Server-only (it mints tokens).
 */

/**
 * Users whose profile row this process has already made sure of. Supabase's
 * `on_auth_user_created` trigger cannot reach Neon, so the first verified
 * session a process sees for a user runs the same insert through
 * `ensure_own_profile()` instead. Bounded so a long-lived process stays small.
 */
const ensuredProfiles = new Set<string>();
const ENSURED_LIMIT = 5_000;

export function identityFromClaims(claims: VerifiedClaims) {
  const name = claims.userMetadata.name;
  return {
    id: claims.id,
    email: claims.email,
    name: typeof name === "string" && name.trim() ? name.trim().slice(0, 200) : null,
  };
}

export async function ensureProfileOnce(userId: string, token: string): Promise<void> {
  if (ensuredProfiles.has(userId)) return;
  const response = await fetch(`${getDataApiUrl()}/rpc/ensure_own_profile`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  }).catch(() => null);
  // A failure is retried on the next request; reads then see "no profile",
  // which every caller already treats as least privileged.
  if (!response?.ok) return;
  if (ensuredProfiles.size >= ENSURED_LIMIT) ensuredProfiles.clear();
  ensuredProfiles.add(userId);
}

export async function userTokenForClaims(claims: VerifiedClaims): Promise<{ token: string; exp: number }> {
  const minted = await userDataApiToken(identityFromClaims(claims));
  await ensureProfileOnce(claims.id, minted.token);
  return minted;
}

type ClaimsCapableClient = Parameters<typeof getVerifiedClaims>[0];

/**
 * The Data API token for whoever this client's cookies belong to: the user's
 * own token after the Supabase JWT verifies locally (as PostgREST verified it
 * before), otherwise the anonymous token.
 */
export async function sessionDataApiToken(client: ClaimsCapableClient): Promise<string> {
  const claims = await getVerifiedClaims(client);
  if (!claims) return anonDataApiToken();
  return (await userTokenForClaims(claims)).token;
}
