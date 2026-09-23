import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getVerifiedClaims } from "@/lib/auth/claims";
import { normalizeRole } from "@/lib/auth/roles";
import { createDataApiFetch, getDataApiUrl } from "@/lib/data-api/fetch";
import { sessionDataApiToken } from "@/lib/data-api/session";

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Allow local development without Supabase env configuration.
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
      // The profile read below runs on the Neon Data API as this user.
      global: {
        fetch: createDataApiFetch({
          supabaseUrl,
          dataApiUrl: getDataApiUrl(),
          getToken: (): Promise<string> => sessionDataApiToken(supabase),
        }),
      },
    }
  );

  // This guard runs on every dashboard navigation. The JWT is verified locally
  // against the project's cached JWKS instead of a round trip to Supabase
  // Auth; the profile row below, not the token, still decides the role. A
  // revoked session is honoured here once its token expires (1 h); every
  // state-changing API route re-checks with auth.getUser().
  const user = await getVerifiedClaims(supabase);

  const pathname = request.nextUrl.pathname;
  const requiresAuth = pathname.startsWith("/dashboard");

  if (requiresAuth && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/auth/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname.startsWith("/dashboard/")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, institution_id")
      .eq("id", user.id)
      .maybeSingle();
    // user_metadata is user-controlled and must never grant an application
    // role. A missing profile is treated as least privileged.
    const role = normalizeRole(profile?.role ?? null);
    const isNgoRoute =
      pathname.startsWith("/dashboard/ngo") || pathname.startsWith("/dashboard/institution");

    if (pathname.startsWith("/dashboard/admin") && role !== "superadmin") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    if (isNgoRoute && role !== "ngo") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    // An `ngo` role with no institution_id has not lodged (or had approved)
    // its UDR_ID claim yet -- see institution_claims. The dashboard has
    // nothing to show that account; send it back to finish onboarding
    // instead of rendering an institution-less page.
    if (isNgoRoute && role === "ngo" && !profile?.institution_id) {
      return NextResponse.redirect(new URL("/auth/setup", request.url));
    }
    // The step before that one: someone who picked "NGO" at signup but never
    // ran complete_profile_setup is still `individual`, so neither the rule
    // above nor the role redirects can see them -- they just land on the
    // individual dashboard with nothing pointing back at onboarding. Signing
    // in with a password never passes through /auth/callback, which is the
    // only other place that recovers this.
    //
    // Reading `user_metadata.role` here grants nothing: it is signup intent
    // used for routing only, the same way /auth/callback and /auth/setup
    // already read it. The role still comes solely from complete_profile_setup
    // and publishing still needs an approved UDR_ID claim. `setup_completed`
    // is what completeIndividualSetup() writes when someone deliberately
    // finishes as an individual, so choosing that on /auth/setup clears this
    // for good and no one can be trapped in a loop.
    if (
      role === "individual" &&
      user.userMetadata.role === "ngo" &&
      user.userMetadata.setup_completed !== true
    ) {
      return NextResponse.redirect(new URL("/auth/setup", request.url));
    }
    if (
      pathname.startsWith("/dashboard/individual") &&
      role !== "individual"
    ) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
