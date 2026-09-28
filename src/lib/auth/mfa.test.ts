import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { dictionaries, resolveKey } from "@/i18n/dictionaries";
import {
  MFA_SETTINGS_HREF,
  hasVerifiedFactor,
  mfaChallengePath,
  mfaErrorKey,
  mfaNextPath,
  normalizeTotpCode,
  pathAfterSignIn,
  sanitizeTotpInput,
} from "@/lib/auth/mfa";
import {
  readerNeedsSecondFactor,
  requireSecondFactor,
  requireSecondFactorIfEnrolled,
  secondFactorPending,
  sessionListsVerifiedFactor,
} from "@/lib/auth/mfa-server";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const VERIFIED = { id: "f1", factor_type: "totp", status: "verified" };
const UNVERIFIED = { id: "f2", factor_type: "totp", status: "unverified" };

/** A client whose session JWT verifies with these claims. */
function claimsClient(claims: Record<string, unknown> | null) {
  const getClaims = vi.fn(async () =>
    claims ? { data: { claims }, error: null } : { data: null, error: { message: "no session" } }
  );
  return { client: { auth: { getClaims } }, getClaims };
}

describe("factor lists", () => {
  it("counts only a verified factor, of any type", () => {
    expect(hasVerifiedFactor(null)).toBe(false);
    expect(hasVerifiedFactor({})).toBe(false);
    expect(hasVerifiedFactor({ factors: [] })).toBe(false);
    expect(hasVerifiedFactor({ factors: [UNVERIFIED] })).toBe(false);
    expect(hasVerifiedFactor({ factors: [UNVERIFIED, VERIFIED] })).toBe(true);
    expect(hasVerifiedFactor({ factors: [{ factor_type: "phone", status: "verified" }] })).toBe(true);
  });
});

describe("where the code page leads", () => {
  it("keeps an internal destination with its query and fragment", () => {
    expect(mfaNextPath("/dashboard/ngo")).toBe("/dashboard/ngo");
    expect(mfaNextPath(MFA_SETTINGS_HREF)).toBe("/dashboard/postavke#dvostupanjska-prijava");
    expect(mfaChallengePath("/doniraj?view=explore")).toBe("/auth/mfa?next=%2Fdoniraj%3Fview%3Dexplore");
  });

  it("never leaves the site and never loops back to itself", () => {
    for (const raw of [null, "", "https://evil.test", "//evil.test", "/auth/mfa", "/auth/mfa?next=/x"]) {
      expect(mfaNextPath(raw), String(raw)).toBe("/dashboard");
    }
    expect(mfaChallengePath("https://evil.test")).toBe("/auth/mfa?next=%2Fdashboard");
  });
});

describe("the six-digit code", () => {
  it("cleans what is typed or pasted as it arrives", () => {
    expect(sanitizeTotpInput("123 456")).toBe("123456");
    expect(sanitizeTotpInput("12-34-56-78")).toBe("123456");
    expect(sanitizeTotpInput("abc")).toBe("");
  });

  it("sends exactly six digits or nothing", () => {
    expect(normalizeTotpCode("123456")).toBe("123456");
    expect(normalizeTotpCode(" 123 456 ")).toBe("123456");
    expect(normalizeTotpCode("123-456")).toBe("123456");
    for (const raw of ["", "12345", "1234567", "12345a", "abcdef"]) {
      expect(normalizeTotpCode(raw), raw).toBeNull();
    }
  });
});

describe("mfaErrorKey", () => {
  it("prefers Supabase's stable code, then the status, then the wording", () => {
    expect(mfaErrorKey({ code: "mfa_verification_failed", message: "Invalid TOTP code entered" }))
      .toBe("mfa.error_code_invalid");
    expect(mfaErrorKey({ code: "mfa_challenge_expired" })).toBe("mfa.error_code_expired");
    expect(mfaErrorKey({ code: "insufficient_aal" })).toBe("mfa.error_insufficient_aal");
    expect(mfaErrorKey({ code: "mfa_totp_enroll_not_enabled" })).toBe("mfa.error_unavailable");
    expect(mfaErrorKey({ status: 429 })).toBe("auth.error_rate_limited");
    expect(mfaErrorKey({ message: "Invalid TOTP code entered" })).toBe("mfa.error_code_invalid");
    expect(mfaErrorKey(new TypeError("Failed to fetch"))).toBe("auth.error_network");
    expect(mfaErrorKey({ code: "something_new", message: "internal detail" })).toBe("mfa.error_generic");
    expect(mfaErrorKey(null)).toBe("mfa.error_generic");
  });

  it("only ever returns a key both dictionaries translate", () => {
    const samples = [
      "mfa_verification_failed", "mfa_verification_rejected", "mfa_challenge_expired",
      "mfa_ip_address_mismatch", "mfa_factor_not_found", "mfa_totp_enroll_not_enabled",
      "mfa_totp_verify_not_enabled", "too_many_enrolled_mfa_factors", "insufficient_aal",
      "over_request_rate_limit", "session_not_found", "session_expired", "request_timeout", "x",
    ].map((code) => mfaErrorKey({ code }));
    for (const key of samples) {
      expect(resolveKey(dictionaries.hr, key), key).not.toBe(key);
      expect(resolveKey(dictionaries.en, key), key).not.toBe(key);
    }
  });
});

describe("pathAfterSignIn", () => {
  function client(level: { currentLevel: string | null; nextLevel: string | null } | Error) {
    return {
      auth: {
        mfa: {
          getAuthenticatorAssuranceLevel: async () => {
            if (level instanceof Error) throw level;
            return { data: level, error: null };
          },
        },
      },
    };
  }

  it("puts the code page first for an account with a factor the session has not used", async () => {
    expect(await pathAfterSignIn(client({ currentLevel: "aal1", nextLevel: "aal2" }), "/dashboard"))
      .toBe("/auth/mfa?next=%2Fdashboard");
  });

  it("goes straight on otherwise, and when it cannot tell", async () => {
    expect(await pathAfterSignIn(client({ currentLevel: "aal1", nextLevel: "aal1" }), "/doniraj"))
      .toBe("/doniraj");
    expect(await pathAfterSignIn(client({ currentLevel: "aal2", nextLevel: "aal2" }), "/doniraj"))
      .toBe("/doniraj");
    expect(await pathAfterSignIn(client(new Error("storage")), "/doniraj")).toBe("/doniraj");
  });
});

describe("server guards", () => {
  it("ask nothing of an account without a verified factor", async () => {
    const { client, getClaims } = claimsClient(null);
    const user = { id: USER_ID, factors: [UNVERIFIED] };
    expect(await secondFactorPending(client, user)).toBe(false);
    expect(await requireSecondFactorIfEnrolled(client, user, "rid")).toBeNull();
    // No verification work at all for the common case.
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("refuse an enrolled account's aal1 session with a stable code", async () => {
    const { client } = claimsClient({ sub: USER_ID, aal: "aal1" });
    const refused = await requireSecondFactorIfEnrolled(client, { id: USER_ID, factors: [VERIFIED] }, "rid");
    expect(refused?.status).toBe(403);
    expect(refused?.headers.get("cache-control")).toBe("no-store");
    expect(refused?.headers.get("x-request-id")).toBe("rid");
    expect(await refused?.json()).toEqual({
      error: "Two-step sign-in required",
      code: "mfa_required",
      request_id: "rid",
    });
  });

  it("let the same account through at aal2, and fail closed without verifiable claims", async () => {
    const user = { id: USER_ID, factors: [VERIFIED] };
    expect(await requireSecondFactorIfEnrolled(claimsClient({ sub: USER_ID, aal: "aal2" }).client, user))
      .toBeNull();
    expect(await secondFactorPending(claimsClient(null).client, user)).toBe(true);
    // A verified token for another account proves nothing about this one.
    expect(
      await secondFactorPending(
        claimsClient({ sub: "99999999-8888-4777-8666-555555555555", aal: "aal2" }).client,
        user
      )
    ).toBe(true);
  });

  it("require a factor and aal2 for administrators", async () => {
    const aal2 = claimsClient({ sub: USER_ID, aal: "aal2" }).client;
    expect(await requireSecondFactor(aal2, { id: USER_ID, factors: [VERIFIED] })).toBeNull();
    // Never enrolled, or the factor was removed while the token is still aal2.
    expect((await requireSecondFactor(aal2, { id: USER_ID }))?.status).toBe(403);
    expect((await requireSecondFactor(aal2, { id: USER_ID, factors: [UNVERIFIED] }))?.status).toBe(403);
    const aal1 = claimsClient({ sub: USER_ID, aal: "aal1" }).client;
    expect((await requireSecondFactor(aal1, { id: USER_ID, factors: [VERIFIED] }))?.status).toBe(403);
  });
});

describe("sessionListsVerifiedFactor", () => {
  /** auth-js hands the server a stored session's user inside a warning proxy. */
  function sessionClient(user: Record<string, unknown> | null) {
    const reads: string[] = [];
    const proxied = user
      ? new Proxy(user, {
          get(target, prop, receiver) {
            reads.push(String(prop));
            return Reflect.get(target, prop, receiver);
          },
        })
      : undefined;
    return {
      reads,
      client: {
        auth: {
          getSession: async () => ({
            data: { session: proxied ? { user: proxied } : null },
            error: null,
          }),
        },
      },
    };
  }

  it("reads the cookie's factor list without tripping the proxy", async () => {
    const enrolled = sessionClient({ id: USER_ID, factors: [VERIFIED] });
    expect(await sessionListsVerifiedFactor(enrolled.client)).toBe(true);
    expect(enrolled.reads).toEqual([]);
    expect(await sessionListsVerifiedFactor(sessionClient({ id: USER_ID, factors: [UNVERIFIED] }).client))
      .toBe(false);
    expect(await sessionListsVerifiedFactor(sessionClient({ id: USER_ID }).client)).toBe(false);
    expect(await sessionListsVerifiedFactor(sessionClient(null).client)).toBe(false);
  });

  it("treats an unreadable session as listing nothing", async () => {
    const broken = { auth: { getSession: async () => { throw new Error("cookie"); } } };
    expect(await sessionListsVerifiedFactor(broken)).toBe(false);
  });

  it("holds back a read-only route's data only from an enrolled session below aal2", async () => {
    const enrolled = sessionClient({ id: USER_ID, factors: [VERIFIED] }).client;
    expect(await readerNeedsSecondFactor(enrolled, { aal: "aal1" })).toBe(true);
    expect(await readerNeedsSecondFactor(enrolled, { aal: "aal2" })).toBe(false);
    const plain = sessionClient({ id: USER_ID }).client;
    expect(await readerNeedsSecondFactor(plain, { aal: "aal1" })).toBe(false);
  });
});

describe("every route that authenticates with auth.getUser()", () => {
  function routes(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(resolve(process.cwd(), dir))) {
      const path = join(dir, entry);
      if (statSync(resolve(process.cwd(), path)).isDirectory()) out.push(...routes(path));
      else if (entry === "route.ts") out.push(path);
    }
    return out;
  }

  it("applies a two-step sign-in rule after it", () => {
    const authenticated = [...routes("src/app/api"), join("src", "app", "auth", "callback", "route.ts")]
      .filter((path) => readFileSync(resolve(process.cwd(), path), "utf8").includes("auth.getUser()"));
    expect(authenticated.length).toBeGreaterThan(15);
    const unguarded = authenticated.filter(
      (path) =>
        !/requireSecondFactorIfEnrolled|requireSecondFactor\(|secondFactorPending/.test(
          readFileSync(resolve(process.cwd(), path), "utf8")
        )
    );
    expect(unguarded).toEqual([]);
  });

  it("and every read-only route that verifies the JWT locally checks the cookie's list", () => {
    const readers = routes("src/app/api").filter((path) =>
      readFileSync(resolve(process.cwd(), path), "utf8").includes("getVerifiedClaims(")
    );
    expect(readers.length).toBeGreaterThan(5);
    const unguarded = readers.filter(
      (path) => !readFileSync(resolve(process.cwd(), path), "utf8").includes("readerNeedsSecondFactor(")
    );
    expect(unguarded).toEqual([]);
  });
});
