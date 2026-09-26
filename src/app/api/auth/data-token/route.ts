import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { userTokenForClaims } from "@/lib/data-api/session";
import { getRequestId } from "@/lib/observability";
import { NO_STORE, jsonError, rateLimit } from "@/lib/security/http";

/**
 * A short-lived Neon Data API token for the browser's own session.
 *
 * This is token issuance, so identity comes from `auth.getUser()` (a round
 * trip that honours revocation), not a locally verified JWT. There is no
 * anonymous token here: every public read is served by an API route or a
 * server component through the server's own anon client, and the browser
 * reaches the Data API directly only for a signed-in user's own rows. A
 * visitor without a session gets 401.
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
      return jsonError("Not authenticated", 401, requestId, NO_STORE);
    }

    const { token, exp } = await userTokenForClaims({
      id: user.id,
      email: user.email ?? null,
      userMetadata: user.user_metadata ?? {},
    });
    return NextResponse.json({ token, exp }, { headers: NO_STORE });
  } catch {
    return jsonError("Data token unavailable", 503, requestId, NO_STORE);
  }
}
