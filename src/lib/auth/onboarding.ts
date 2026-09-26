/**
 * Links into NGO onboarding and the sign-up intent they carry.
 *
 * `?role=ngo` (or the Croatian `?uloga=udruga`, for links typed into an
 * invitation) only preselects a screen. It grants nothing: the `ngo` role
 * still comes from complete_profile_setup and publishing still needs an
 * approved claim against the official register.
 */

/** Sign-up with "Predstavljam udrugu" already chosen. */
export const NGO_SIGNUP_HREF = "/auth/register?role=ngo";

/** The same intent for someone who already has an account. */
export const NGO_SETUP_HREF = "/auth/setup?role=ngo";

export function signupRoleFromParams(params: URLSearchParams): "ngo" | null {
  const role = params.get("role")?.trim().toLowerCase();
  const uloga = params.get("uloga")?.trim().toLowerCase();
  return role === "ngo" || uloga === "udruga" ? "ngo" : null;
}
