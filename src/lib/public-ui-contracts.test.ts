import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("public UI accessibility contracts", () => {
  it("keeps filter state programmatically exposed", () => {
    const filterBar = source("src/components/FilterBar.tsx");
    // `/needs` and `/volunteer` are thin server shells that exist only to
    // export localized metadata; the interactive markup lives in the client
    // components these assertions point at.
    const needsPage = source("src/app/needs/needs-client.tsx");
    expect(filterBar).toContain("aria-pressed={on}");
    // The Zagreb-only/urgent-only chips were deliberately removed from this
    // bar (the onboarded chip moved to the front instead) — see FilterBar.tsx.
    expect(filterBar).toContain("aria-pressed={filters.onlyOnboarded}");
    expect(needsPage).toContain("aria-pressed={donationType === \"all\"}");
  });

  it("keeps async errors and loading state announced", () => {
    for (const path of [
      "src/app/needs/needs-client.tsx",
      "src/app/volunteer/volunteer-client.tsx",
    ]) {
      const contents = source(path);
      expect(contents).toContain('role="status"');
      expect(contents).toContain('role="alert"');
    }
  });

  it("keeps volunteer progress and calendar navigation accessible", () => {
    const card = source("src/components/VolunteerEventCard.tsx");
    const calendar = source("src/components/VolunteerCalendar.tsx");
    expect(card).toContain('role="progressbar"');
    expect(card).toContain("tabIndex={-1}");
    expect(calendar).toContain("volunteer_calendar.previous_month");
    expect(calendar).toContain("volunteer_calendar.next_month");
  });

  it("keeps map search exposed as an expandable combobox", () => {
    // The map is the home page now; `src/app/map/page.tsx` is only the
    // permanent redirect that keeps older links working.
    const mapPage = source("src/app/map/map-experience.tsx");
    expect(mapPage).toContain('role="combobox"');
    expect(mapPage).toContain('aria-autocomplete="list"');
    expect(mapPage).toContain('role="listbox"');
    expect(mapPage).toContain('role="option"');
  });
});
