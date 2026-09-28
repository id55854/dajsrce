import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestId, logError } from "@/lib/observability";
import { NO_STORE, rateLimit } from "@/lib/security/http";
import { isUnsubscribeToken, unsubscribeTokenDigest } from "@/lib/email/notification-emails";

export const dynamic = "force-dynamic";

const PAGE = "/obavijesti/odjava";

function pageRedirect(req: NextRequest, query: string): NextResponse {
  const response = NextResponse.redirect(new URL(`${PAGE}${query}`, req.nextUrl.origin), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/**
 * A GET (a click on the List-Unsubscribe URL, or a mail scanner prefetching
 * it) never unsubscribes: it only opens the confirmation page.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  return pageRedirect(req, isUnsubscribeToken(token) ? `?t=${token}` : "");
}

/**
 * Turns off notification e-mail for the token's account. Two callers:
 * a mail client's RFC 8058 one-click POST (body `List-Unsubscribe=One-Click`,
 * token in the URL) and the confirmation page's form (token in the body).
 *
 * Deliberately exempt from the same-origin rule every other unsafe route
 * follows: a mail client posts from outside the site by design. The token is
 * the whole authority (a 256-bit secret per message, stored only as a
 * digest), and all it can do is turn e-mail off.
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const limited = rateLimit(req, { name: "notification_emails.unsubscribe", limit: 20, windowMs: 60_000 }, requestId);
  if (limited) return limited;

  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    form = null;
  }
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const bodyToken = form?.get("t");
  const token = req.nextUrl.searchParams.get("t") ?? (typeof bodyToken === "string" ? bodyToken : null);

  if (!isUnsubscribeToken(token)) {
    return oneClick
      ? NextResponse.json({ error: "Invalid link", request_id: requestId }, { status: 400, headers: NO_STORE })
      : pageRedirect(req, "?nevazeca=1");
  }

  const { data, error } = await supabaseAdmin.rpc("unsubscribe_notification_emails", {
    p_token_hash: unsubscribeTokenDigest(token),
  });
  if (error) {
    logError("notification_emails.unsubscribe_failed", error, { request_id: requestId });
    return oneClick
      ? NextResponse.json({ error: "Unavailable", request_id: requestId }, { status: 503, headers: NO_STORE })
      : pageRedirect(req, `?t=${token}&greska=1`);
  }

  if (data !== true) {
    return oneClick
      ? NextResponse.json({ error: "Unknown link", request_id: requestId }, { status: 404, headers: NO_STORE })
      : pageRedirect(req, "?nevazeca=1");
  }
  return oneClick
    ? NextResponse.json({ ok: true, request_id: requestId }, { headers: NO_STORE })
    : pageRedirect(req, "?gotovo=1");
}
