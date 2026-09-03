import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeRole, roleToDashboardPath } from "@/lib/auth/roles";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
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
          return NextResponse.redirect(`${origin}/auth/setup`);
        }

        if (next === "/dashboard") {
          return NextResponse.redirect(`${origin}${roleToDashboardPath(role)}`);
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`);
}
