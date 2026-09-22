import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("public UI accessibility contracts", () => {
  it("keeps filter state programmatically exposed", () => {
    const filterBar = source("src/components/FilterBar.tsx");
    const dropdown = source("src/components/FilterDropdown.tsx");
    expect(filterBar).toContain("checked={filters.onlyOnboarded}");
    expect(filterBar).toContain('role="switch"');
    expect(dropdown).toContain("aria-expanded={open}");
    expect(dropdown).toContain("checked={value.includes(option.value)}");
    expect(dropdown).toContain('type={multiple ? "checkbox" : "radio"}');

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
