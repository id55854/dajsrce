import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { anonDataApiToken } from "@/lib/data-api/token";
import { userTokenForClaims } from "@/lib/data-api/session";
import { parseAuthenticatorLevel } from "@/lib/auth/mfa";
import { getRequestId } from "@/lib/observability";
import { NO_STORE, jsonError, rateLimit } from "@/lib/security/http";

const ANON_TOKEN_LIFETIME_SECONDS = 9 * 60;

/**
 * A short-lived Neon Data API token for the browser's own session.
 *
 * This is token issuance, so identity comes from `auth.getUser()` (a round
 * trip that honours revocation), not a locally verified JWT. Without a session
 * the caller gets the shared `anon` token, which reads only what the public
 * API already serves.
 */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked = rateLimit(req, { name: "auth.data-token", limit: 60, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;
  // requireSameOrigin() exempts GET; a token belongs to this origin's pages only.
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return jsonError("Invalid request origin", 403, requestId, NO_STORE);
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.is_anonymous) {
      const token = await anonDataApiToken();
      const exp = Math.floor(Date.now() / 1000) + ANON_TOKEN_LIFETIME_SECONDS;
      return NextResponse.json({ token, exp }, { headers: NO_STORE });
    }

    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const { token, exp } = await userTokenForClaims({
      id: user.id,
      email: user.email ?? null,
      userMetadata: user.user_metadata ?? {},
      authenticatorLevel: parseAuthenticatorLevel(assurance?.currentLevel),
    });
    return NextResponse.json({ token, exp }, { headers: NO_STORE });
  } catch {
    return jsonError("Data token unavailable", 503, requestId, NO_STORE);
  }
}
