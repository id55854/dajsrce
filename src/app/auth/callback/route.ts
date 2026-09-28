import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeRole, roleToDashboardPath } from "@/lib/auth/roles";
import { safeInternalPath } from "@/lib/security/redirects";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * E-mail link types a template may send as a portable token hash. Recovery is
 * handled on its own, before these, because it lands on the password form.
 */
const EMAIL_LINK_TYPES = ["email", "signup", "invite", "magiclink", "email_change"] as const;
type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

function emailLinkType(value: string | null): EmailLinkType | null {
  return (EMAIL_LINK_TYPES as readonly string[]).includes(value ?? "")
    ? (value as EmailLinkType)
    : null;
}

function authRedirect(destination: string): NextResponse {
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/** Where a freshly established session goes: onboarding first, then `next`. */
async function signedInRedirect(
  supabase: ServerSupabase,
  origin: string,
  next: string
): Promise<NextResponse> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, institution_id")
      .eq("id", user.id)
      .maybeSingle();

    const isOAuth = user.app_metadata?.provider !== "email";
    const role = normalizeRole(profile?.role);
    const isNewOAuth =
      isOAuth &&
      user.created_at &&
      Date.now() - new Date(user.created_at).getTime() < 60_000;

    // handle_new_user() always creates the profile as `individual`
    // role is never trusted from signup metadata. Someone who picked
    // "NGO" (email/password or OAuth) still has to run complete_profile_setup
    // via /auth/setup, and an NGO profile with no institution_id yet
    // still needs to lodge its UDR_ID claim there.
    const pickedNgo = user.user_metadata?.role === "ngo";
    const needsNgoOnboarding =
      (pickedNgo && role !== "ngo") || (role === "ngo" && !profile?.institution_id);

    if (isNewOAuth || needsNgoOnboarding) {
      return authRedirect(`${origin}/auth/setup`);
    }

    if (next === "/dashboard") {
      return authRedirect(`${origin}${roleToDashboardPath(role)}`);
    }
  }

  return authRedirect(`${origin}${next}`);
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const flowId = searchParams.get("sb_flow_id");
  const next = safeInternalPath(searchParams.get("next"));
  const isRecovery = searchParams.get("type") === "recovery" || next === "/auth/reset-password";
  const recoveryUrl = `${origin}/auth/reset-password`;

  if (isRecovery && searchParams.has("error")) {
    return authRedirect(`${recoveryUrl}?error=invalid_recovery`);
  }

  // Recovery templates can send a token hash directly. Unlike a PKCE code,
  // this also works when the email is opened on another device.
  if (tokenHash && searchParams.get("type") === "recovery") {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    return authRedirect(error ? `${recoveryUrl}?error=invalid_recovery` : recoveryUrl);
  }

  // The sign-up confirmation (and e-mail change) templates send a token hash
  // too. A PKCE code only exchanges in the browser that started the sign-up,
  // so a confirmation opened on a phone after registering on a computer used
  // to confirm the address and then report a failed sign-in.
  const linkType = emailLinkType(searchParams.get("type"));
  if (tokenHash && linkType) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: linkType });
    if (error) {
      // Expired, already used or superseded by a newer link. An address that
      // was confirmed by the first click can simply sign in.
      return authRedirect(`${origin}/auth/login?error=link_invalid`);
    }
    return signedInRedirect(supabase, origin, next);
  }

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined
    );
    if (!error) {
      // Password recovery takes priority over OAuth/NGO onboarding.
      if (isRecovery || ("redirectType" in data && data.redirectType === "recovery")) {
        return authRedirect(recoveryUrl);
      }
      return signedInRedirect(supabase, origin, next);
    }
  }

  if (isRecovery) {
    // A legacy link may carry its session in a URL fragment, invisible to
    // this server route. The browser preserves it across this redirect.
    return authRedirect(code ? `${recoveryUrl}?error=invalid_recovery` : recoveryUrl);
  }

  return authRedirect(`${origin}/auth/login?error=auth_failed`);
}
