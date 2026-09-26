import { describe, expect, it } from "vitest";
import { NGO_SETUP_HREF, NGO_SIGNUP_HREF, signupRoleFromParams } from "@/lib/auth/onboarding";
import {
  TERMS_VERSION,
  hasAcceptedCurrentTerms,
  termsAcceptance,
} from "@/lib/auth/terms";

describe("signupRoleFromParams", () => {
  it("reads the NGO intent in English and in Croatian", () => {
    expect(signupRoleFromParams(new URLSearchParams("role=ngo"))).toBe("ngo");
    expect(signupRoleFromParams(new URLSearchParams("role=NGO"))).toBe("ngo");
    expect(signupRoleFromParams(new URLSearchParams("uloga=udruga"))).toBe("ngo");
    expect(signupRoleFromParams(new URLSearchParams("next=/doniraj&uloga=Udruga"))).toBe("ngo");
  });

  it("ignores anything else rather than guessing a role", () => {
    for (const query of ["", "role=superadmin", "role=individual", "uloga=admin", "role="]) {
      expect(signupRoleFromParams(new URLSearchParams(query)), query).toBeNull();
    }
  });

  it("builds links the parser understands", () => {
    for (const href of [NGO_SIGNUP_HREF, NGO_SETUP_HREF]) {
      const url = new URL(href, "https://dajsrce.hr");
      expect(signupRoleFromParams(url.searchParams), href).toBe("ngo");
    }
  });
});

describe("terms acceptance", () => {
  it("stamps the current version with an ISO time", () => {
    const now = new Date("2026-09-28T08:30:00Z");
    expect(termsAcceptance(now)).toEqual({
      terms_version: TERMS_VERSION,
      terms_accepted_at: "2026-09-28T08:30:00.000Z",
    });
  });

  it("asks again when the version is missing, old or incomplete", () => {
    expect(hasAcceptedCurrentTerms(termsAcceptance())).toBe(true);
    expect(hasAcceptedCurrentTerms({})).toBe(false);
    expect(hasAcceptedCurrentTerms(null)).toBe(false);
    expect(
      hasAcceptedCurrentTerms({ terms_version: "2020-01-01", terms_accepted_at: "2020-01-01T00:00:00Z" })
    ).toBe(false);
    expect(hasAcceptedCurrentTerms({ terms_version: TERMS_VERSION })).toBe(false);
  });
});
