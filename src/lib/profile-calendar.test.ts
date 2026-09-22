import { describe, expect, it } from "vitest";
import { calendarDate, individualCalendarEntries, institutionCalendarEntries } from "./profile-calendar";

const need = { id: "n1", title: "Hrana", deadline: "2026-10-01T00:00:00Z", created_at: "2026-09-20T12:00:00Z" };
const event = { id: "e1", title: "Volontiranje", event_date: "2026-10-02", start_time: "09:00", created_at: "2026-09-21T12:00:00Z" };

describe("profile calendars", () => {
  it("places late-night publications on the Croatian calendar date", () => {
    expect(calendarDate("2026-09-22T23:00:00Z")).toBe("2026-09-23");
  });
  it("shows actual deadlines and signup dates, never pledge creation dates", () => {
    expect(individualCalendarEntries([{ id: "p1", need }], [{ id: "s1", event }])).toEqual([
      { id: "pledge-p1", title: "Hrana", date: "2026-10-01", kind: "donation", href: "#pledge-p1" },
      { id: "signup-s1", title: "Volontiranje", date: "2026-10-02", time: "09:00", kind: "volunteer", href: "#signup-s1" },
    ]);
  });
  it("omits withdrawn, fulfilled, undated and missing donations or deleted events", () => {
    expect(individualCalendarEntries([
      { id: "a", need, status: "cancelled" },
      { id: "b", need: { ...need, is_fulfilled: true } },
      { id: "c", need: { ...need, deadline: null } },
      { id: "d", need: null },
    ], [{ id: "s", event: null }])).toEqual([]);
  });
  it("distinguishes NGO publications from event dates and donation deadlines", () => {
    const entries = institutionCalendarEntries([need], [event]);
    expect(entries.map(({ kind, date }) => ({ kind, date }))).toEqual([
      { kind: "publication", date: "2026-09-20" },
      { kind: "donation", date: "2026-10-01" },
      { kind: "publication", date: "2026-09-21" },
      { kind: "volunteer", date: "2026-10-02" },
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(4);
  });
  it("keeps publication history when a need is fulfilled, without an active deadline", () => {
    expect(institutionCalendarEntries([{ ...need, is_fulfilled: true }], []).map((entry) => entry.kind)).toEqual(["publication"]);
  });
});
