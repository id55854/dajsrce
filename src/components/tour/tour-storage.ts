/**
 * First-visit bookkeeping for the walkthrough, kept apart from the tour itself
 * so the map's start prompt and the navbar can ask "is the tour still to come?"
 * without loading it.
 *
 * `dajsrce-tour` (localStorage) records that the tour was finished or skipped;
 * it is listed on the cookie page with the other preference keys. Progress
 * through a running tour is kept in sessionStorage, so a reload mid-tour picks
 * up where it was and a new visit does not.
 */

import type { TourTrack } from "./tour-steps";

export const TOUR_DONE_KEY = "dajsrce-tour";
export const TOUR_PROGRESS_KEY = "dajsrce-tour-progress";

/** Fired on window to (re)open the tour from anywhere, e.g. the footer link. */
export const OPEN_TOUR_EVENT = "dajsrce:open-tour";
/** Fired on window once the tour is finished or skipped. */
export const TOUR_SETTLED_EVENT = "dajsrce:tour-settled";

export type TourProgress = {
  track: TourTrack | null;
  index: number;
  /** Where the visitor was when the tour opened; skipping returns there. */
  origin: string;
};

/**
 * True when the tour has never been finished or skipped here. A storage
 * failure answers false: a first-visit overlay must never be something a
 * private window can get stuck behind.
 */
export function isTourPending(): boolean {
  try {
    return window.localStorage.getItem(TOUR_DONE_KEY) == null;
  } catch {
    return false;
  }
}

export function markTourSettled(): void {
  try {
    window.localStorage.setItem(TOUR_DONE_KEY, "done");
  } catch {
    /* The tour still closes for this page view. */
  }
  clearTourProgress();
  window.dispatchEvent(new Event(TOUR_SETTLED_EVENT));
}

export function readTourProgress(): TourProgress | null {
  try {
    const raw = window.sessionStorage.getItem(TOUR_PROGRESS_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<TourProgress>;
    if (typeof value.index !== "number" || !Number.isInteger(value.index) || value.index < 0) return null;
    const track = value.track === "individual" || value.track === "ngo" ? value.track : null;
    const origin = typeof value.origin === "string" && value.origin.startsWith("/") && !value.origin.startsWith("//") ? value.origin : "/";
    return { track, index: value.index, origin };
  } catch {
    return null;
  }
}

export function writeTourProgress(progress: TourProgress): void {
  try {
    window.sessionStorage.setItem(TOUR_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* Progress only matters across a reload. */
  }
}

export function clearTourProgress(): void {
  try {
    window.sessionStorage.removeItem(TOUR_PROGRESS_KEY);
  } catch {
    /* Nothing to clear. */
  }
}

export function openTour(): void {
  window.dispatchEvent(new Event(OPEN_TOUR_EVENT));
}
