import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeRole, roleToDashboardPath } from "@/lib/auth/roles";
import { safeInternalPath } from "@/lib/security/redirects";

function authRedirect(destination: string): NextResponse {
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
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
  }

  if (isRecovery) {
    // A legacy link may carry its session in a URL fragment, invisible to
    // this server route. The browser preserves it across this redirect.
    return authRedirect(code ? `${recoveryUrl}?error=invalid_recovery` : recoveryUrl);
  }

  return authRedirect(`${origin}/auth/login?error=auth_failed`);
}
