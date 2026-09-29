import type { SceneName } from "./illustrations";

/**
 * The walkthrough as data. The engine (`Tour.tsx`) only knows how to open a
 * page, find a `data-tour` hook on it and point at it; what is said, where and
 * in which order lives here, so it can be read and tested without a browser.
 *
 * A step with a `path` is shown on that page, and the tour navigates there
 * first. `targets` lists `data-tour` names in order of preference: the first
 * one that is actually visible wins, which is how a desktop-only control falls
 * back to its phone counterpart. A step whose targets are all missing (an
 * empty list, a control only a signed-in account has) is shown as a centred
 * card instead of pointing at nothing.
 */

export type TourTrack = "individual" | "ngo";

export type TourStep = {
  id: string;
  scene: SceneName;
  /** Key prefix under `tour.steps`; the step reads `<key>_title` and `<key>_body`. */
  copy: string;
  path?: string;
  targets?: readonly string[];
};

/** Who is looking: nobody yet, or a signed-in account of a known kind. */
export type TourViewer = { signedIn: false } | { signedIn: true; role: TourTrack };

const HOME = "/";
const LOGIN = "/auth/login";
const REGISTER = "/auth/register";
const REGISTER_NGO = "/auth/register?role=ngo";

/** The first card; on it an anonymous visitor says who they are. */
export const INTRO_STEP: TourStep = { id: "intro", scene: "welcome", copy: "intro" };

const INDIVIDUAL_AUTH: readonly TourStep[] = [
  { id: "sign-in-button", scene: "signIn", copy: "sign_in_button", path: HOME, targets: ["nav-sign-in", "nav-menu"] },
  { id: "login-form", scene: "login", copy: "login_form", path: LOGIN, targets: ["login-form"] },
  { id: "login-google", scene: "login", copy: "login_google", path: LOGIN, targets: ["login-google"] },
  { id: "login-sign-up", scene: "signUp", copy: "login_sign_up", path: LOGIN, targets: ["login-sign-up"] },
  { id: "register-role", scene: "roleChoice", copy: "register_role_individual", path: REGISTER, targets: ["register-role-individual"] },
  { id: "register-form", scene: "signUp", copy: "register_form_individual", path: REGISTER, targets: ["register-continue"] },
];

const NGO_AUTH: readonly TourStep[] = [
  { id: "register-ngo-button", scene: "signIn", copy: "register_ngo_button", path: HOME, targets: ["nav-register-ngo", "nav-menu"] },
  { id: "register-role", scene: "roleChoice", copy: "register_role_ngo", path: REGISTER, targets: ["register-role-ngo"] },
  { id: "register-form", scene: "signUp", copy: "register_form_ngo", path: REGISTER_NGO, targets: ["register-email"] },
  { id: "claim", scene: "claim", copy: "claim" },
  { id: "claim-verify", scene: "verify", copy: "claim_verify" },
  { id: "login-existing", scene: "login", copy: "login_existing_ngo", path: LOGIN, targets: ["login-form"] },
];

const INDIVIDUAL_FEATURES: readonly TourStep[] = [
  { id: "map-search", scene: "mapSearch", copy: "map_search", path: HOME, targets: ["map-search"] },
  { id: "map-filters", scene: "filters", copy: "map_filters", path: HOME, targets: ["map-filters"] },
  { id: "map-pins", scene: "mapPins", copy: "map_pins", path: HOME, targets: ["map-canvas"] },
  { id: "map-locate", scene: "mapSearch", copy: "map_locate", path: HOME, targets: ["map-locate"] },
  { id: "map-results", scene: "profile", copy: "map_results", path: HOME, targets: ["map-results", "map-search"] },
  { id: "donate-needs", scene: "needs", copy: "donate_needs", path: "/doniraj", targets: ["donate-view-needs"] },
  { id: "donate-pledge", scene: "pledge", copy: "donate_pledge", path: "/doniraj", targets: ["need-card"] },
  { id: "donate-wizard", scene: "wizard", copy: "donate_wizard", path: "/doniraj", targets: ["donate-view-explore"] },
  { id: "volunteer-events", scene: "volunteer", copy: "volunteer_events", path: "/volunteer", targets: ["volunteer-event", "volunteer-period"] },
  { id: "volunteer-signup", scene: "calendar", copy: "volunteer_signup", path: "/volunteer", targets: ["volunteer-period"] },
  { id: "notifications", scene: "notifications", copy: "notifications", targets: ["nav-bell"] },
  { id: "profile", scene: "profile", copy: "profile_individual", targets: ["nav-profile"] },
];

const NGO_FEATURES: readonly TourStep[] = [
  { id: "ngo-find", scene: "mapSearch", copy: "ngo_find", path: HOME, targets: ["map-search"] },
  { id: "ngo-profile", scene: "ngoProfile", copy: "ngo_profile", targets: ["nav-profile"] },
  { id: "ngo-needs", scene: "ngoNeeds", copy: "ngo_needs", targets: ["nav-ngo-pledges"] },
  { id: "ngo-pledges", scene: "ngoPledges", copy: "ngo_pledges", targets: ["nav-ngo-pledges"] },
  { id: "ngo-events", scene: "ngoEvents", copy: "ngo_events", targets: ["nav-ngo-volunteering"] },
  { id: "ngo-volunteers", scene: "ngoVolunteers", copy: "ngo_volunteers", targets: ["nav-ngo-volunteering"] },
  { id: "notifications", scene: "notifications", copy: "ngo_notifications", targets: ["nav-bell"] },
];

const SETTINGS_STEP: TourStep = { id: "settings", scene: "verify", copy: "settings" };
const DONE_STEP: TourStep = { id: "done", scene: "done", copy: "done" };

/**
 * The full sequence for one track. The sign-in part is only for someone who
 * is not signed in yet; a signed-in account goes straight to what it can do,
 * and its own role picks the track rather than the choice on the first card.
 */
export function buildTourSteps(track: TourTrack, viewer: TourViewer): TourStep[] {
  const effective = viewer.signedIn ? viewer.role : track;
  const auth = viewer.signedIn ? [] : effective === "ngo" ? NGO_AUTH : INDIVIDUAL_AUTH;
  const features = (effective === "ngo" ? NGO_FEATURES : INDIVIDUAL_FEATURES).map((step) =>
    withAccountTargets(step, viewer.signedIn)
  );
  return [INTRO_STEP, ...auth, ...features, SETTINGS_STEP, DONE_STEP];
}

/** Navbar controls that only a signed-in account has. */
const ACCOUNT_TARGETS = new Set(["nav-bell", "nav-profile", "nav-ngo-pledges", "nav-ngo-volunteering"]);

/**
 * A signed-in account on a phone reaches its profile and NGO pages through the
 * menu button, so those steps point there when the desktop link is hidden.
 * Nobody signed in has them anywhere; pointing at the menu would promise a
 * link that is not in it, so those steps become centred cards instead.
 */
function withAccountTargets(step: TourStep, signedIn: boolean): TourStep {
  if (!step.targets?.some((target) => ACCOUNT_TARGETS.has(target))) return step;
  if (!signedIn) {
    return { ...step, targets: step.targets.filter((target) => !ACCOUNT_TARGETS.has(target)) };
  }
  const phoneFallback = step.targets.includes("nav-bell") ? [] : ["nav-menu"];
  return { ...step, targets: [...step.targets, ...phoneFallback] };
}

/** Whether the browser is already on the page a step belongs to. */
export function isOnStepPath(step: TourStep, pathname: string, search: string): boolean {
  if (!step.path) return true;
  const [path, query = ""] = step.path.split("?");
  if (pathname !== path) return false;
  const wanted = new URLSearchParams(query);
  const current = new URLSearchParams(search);
  for (const [key, value] of wanted) {
    if (current.get(key) !== value) return false;
  }
  // `/auth/register` (the role tiles) and `/auth/register?role=ngo` (the form)
  // are different screens of one page; the bare path must not match the form.
  if (!query && path === REGISTER && current.has("role")) return false;
  return true;
}

/** Pages where the tour may open by itself on a first visit. */
export const AUTO_START_PATHS: readonly string[] = [HOME, "/doniraj", "/volunteer", "/organisations", "/o-nama"];
