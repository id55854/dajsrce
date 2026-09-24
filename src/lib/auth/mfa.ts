import type { AppRole } from "@/lib/auth/roles";

export type AuthenticatorLevel = "aal1" | "aal2" | null;

export function parseAuthenticatorLevel(value: string | null | undefined): AuthenticatorLevel {
  if (value === "aal1" || value === "aal2") return value;
  return null;
}

export type MfaGate = "challenge" | "enroll" | null;

/**
 * Decide whether this session may open a privileged surface.
 *
 * A verified factor always has to be challenged (`aal2`), for every role.
 * Enrolment is required only once the account can publish or administer:
 * an NGO still onboarding (no `institution_id`) and an individual are not
 * locked out. Roles come from `profiles`, never from user metadata.
 */
export function mfaGateDecision(input: {
  role: AppRole;
  hasInstitution: boolean;
  currentLevel: AuthenticatorLevel;
  nextLevel: AuthenticatorLevel;
}): MfaGate {
  if (input.nextLevel === "aal2" && input.currentLevel !== "aal2") return "challenge";
  const mustEnroll =
    input.role === "superadmin" || (input.role === "ngo" && input.hasInstitution);
  if (mustEnroll && input.currentLevel !== "aal2") return "enroll";
  return null;
}

/** API routes whose data is donor contact, publishing, or claim review. */
export function isMfaGatedApiPath(pathname: string): boolean {
  if (/^\/api\/institution-claims\/[^/]+\/review\/?$/.test(pathname)) return true;
  return /^\/api\/(?:needs|pledges|volunteer-events|volunteer-signups|institution|notifications)(?:\/|$)/.test(
    pathname
  );
}
