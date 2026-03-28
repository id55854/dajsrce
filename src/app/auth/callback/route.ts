import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
        const needsSetup = isOAuth && profile && !profile.institution_id && profile.role === "citizen";
        const isNewOAuth =
          isOAuth &&
          user.created_at &&
          Date.now() - new Date(user.created_at).getTime() < 60_000;

        if (isNewOAuth || (needsSetup && isNewOAuth)) {
          return NextResponse.redirect(`${origin}/auth/setup`);
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`);
}
