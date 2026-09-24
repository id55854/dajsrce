import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getVerifiedClaims } from "@/lib/auth/claims";
import { isMfaGatedApiPath, mfaGateDecision, parseAuthenticatorLevel } from "@/lib/auth/mfa";
import { normalizeRole } from "@/lib/auth/roles";
import { createDataApiFetch, getDataApiUrl } from "@/lib/data-api/fetch";
import { sessionDataApiToken } from "@/lib/data-api/session";
import { contentSecurityPolicy } from "@/lib/security/csp";
import { safeInternalPath } from "@/lib/security/redirects";

function dataApiOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_DATA_API_URL ?? "").origin;
  } catch {
    return "";
  }
}

export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV !== "production",
    connectOrigins: [dataApiOrigin()],
  });

  const requestHeaders = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return headers;
  };

  const withCsp = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  const continueRequest = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders() } });
    return withCsp(response);
  };

  const pathname = request.nextUrl.pathname;
  const gatedApi = isMfaGatedApiPath(pathname);
  const gatedPage = pathname.startsWith("/dashboard");

  if (!gatedPage && !gatedApi) {
    return continueRequest();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return continueRequest();
  }

  let supabaseResponse = continueRequest();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = continueRequest();
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
    global: {
      fetch: createDataApiFetch({
        supabaseUrl,
        dataApiUrl: getDataApiUrl(),
        getToken: (): Promise<string> => sessionDataApiToken(supabase),
      }),
    },
  });

  const user = await getVerifiedClaims(supabase);

  if (gatedPage && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/auth/login";
    loginUrl.searchParams.set("next", pathname);
    return withCsp(NextResponse.redirect(loginUrl));
  }

  if (!user) return supabaseResponse;

  if (gatedPage && pathname.startsWith("/dashboard/")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, institution_id")
      .eq("id", user.id)
      .maybeSingle();
    const role = normalizeRole(profile?.role ?? null);
    const isNgoRoute =
      pathname.startsWith("/dashboard/ngo") || pathname.startsWith("/dashboard/institution");

    if (pathname.startsWith("/dashboard/admin") && role !== "superadmin") {
      return withCsp(NextResponse.redirect(new URL("/dashboard", request.url)));
    }
    if (isNgoRoute && role !== "ngo") {
      return withCsp(NextResponse.redirect(new URL("/dashboard", request.url)));
    }
    if (isNgoRoute && role === "ngo" && !profile?.institution_id) {
      return withCsp(NextResponse.redirect(new URL("/auth/setup", request.url)));
    }
    if (
      role === "individual" &&
      user.userMetadata.role === "ngo" &&
      user.userMetadata.setup_completed !== true
    ) {
      return withCsp(NextResponse.redirect(new URL("/auth/setup", request.url)));
    }
    if (pathname.startsWith("/dashboard/individual") && role !== "individual") {
      return withCsp(NextResponse.redirect(new URL("/dashboard", request.url)));
    }
  }

  const blocked = await mfaResponse(
    supabase as unknown as Parameters<typeof mfaResponse>[0],
    user.id,
    request,
    gatedApi
  );
  if (blocked) return withCsp(blocked);

  return supabaseResponse;
}

async function mfaResponse(
  supabase: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => PromiseLike<{ data: { role: string | null; institution_id: string | null } | null }>;
        };
      };
    };
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: () => PromiseLike<{
          data: { currentLevel?: string | null; nextLevel?: string | null } | null;
          error: unknown;
        }>;
      };
    };
  },
  userId: string,
  request: NextRequest,
  asJson: boolean
): Promise<NextResponse | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, institution_id")
    .eq("id", userId)
    .maybeSingle();
  const { data: assurance, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (error || !assurance) {
    if (asJson) {
      return NextResponse.json(
        { error: "Multi-factor authentication is temporarily unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/auth/mfa";
    url.searchParams.set("error", "unavailable");
    url.searchParams.set("next", safeInternalPath(request.nextUrl.pathname));
    return NextResponse.redirect(url);
  }

  const decision = mfaGateDecision({
    role: normalizeRole(profile?.role ?? null),
    hasInstitution: Boolean(profile?.institution_id),
    currentLevel: parseAuthenticatorLevel(assurance.currentLevel),
    nextLevel: parseAuthenticatorLevel(assurance.nextLevel),
  });
  if (!decision) return null;

  if (asJson) {
    return NextResponse.json(
      {
        error:
          decision === "enroll"
            ? "Multi-factor enrolment is required"
            : "Multi-factor authentication is required",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/auth/mfa";
  url.searchParams.set("next", safeInternalPath(request.nextUrl.pathname));
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
