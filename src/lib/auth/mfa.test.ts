import { describe, expect, it } from "vitest";
import { isMfaGatedApiPath, mfaGateDecision } from "./mfa";

describe("mfa gate", () => {
  it("lets an individual and an onboarding NGO through on a password session", () => {
    expect(
      mfaGateDecision({
        role: "individual",
        hasInstitution: false,
        currentLevel: "aal1",
        nextLevel: "aal1",
      })
    ).toBeNull();
    expect(
      mfaGateDecision({
        role: "ngo",
        hasInstitution: false,
        currentLevel: "aal1",
        nextLevel: "aal1",
      })
    ).toBeNull();
  });

  it("requires enrolment for an NGO with an institution and for a superadmin", () => {
    expect(
      mfaGateDecision({
        role: "ngo",
        hasInstitution: true,
        currentLevel: "aal1",
        nextLevel: "aal1",
      })
    ).toBe("enroll");
    expect(
      mfaGateDecision({
        role: "superadmin",
        hasInstitution: false,
        currentLevel: "aal1",
        nextLevel: "aal1",
      })
    ).toBe("enroll");
  });

  it("requires a challenge once a factor is enrolled, then lets aal2 through", () => {
    expect(
      mfaGateDecision({
        role: "individual",
        hasInstitution: false,
        currentLevel: "aal1",
        nextLevel: "aal2",
      })
    ).toBe("challenge");
    expect(
      mfaGateDecision({
        role: "ngo",
        hasInstitution: true,
        currentLevel: "aal2",
        nextLevel: "aal2",
      })
    ).toBeNull();
  });

  it("gates publishing and claim review, not onboarding or the public map", () => {
    expect(isMfaGatedApiPath("/api/needs")).toBe(true);
    expect(isMfaGatedApiPath("/api/institution/pledges")).toBe(true);
    expect(isMfaGatedApiPath("/api/institution-claims/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/review")).toBe(true);
    expect(isMfaGatedApiPath("/api/institution-claims")).toBe(false);
    expect(isMfaGatedApiPath("/api/v1/map/institutions")).toBe(false);
  });
});
