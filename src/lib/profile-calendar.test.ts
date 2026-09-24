import { describe, expect, it } from "vitest";
import { calendarDate, individualCalendarEntries, institutionCalendarEntries } from "./profile-calendar";

const need = { id: "n1", title: "Hrana", deadline: "2026-10-01T00:00:00Z", created_at: "2026-09-20T12:00:00Z" };
const event = { id: "e1", title: "Volontiranje", event_date: "2026-10-02", start_time: "09:00", created_at: "2026-09-21T12:00:00Z" };

describe("profile calendars", () => {
  it("places late-night publications on the Croatian calendar date", () => {
    expect(calendarDate("2026-09-22T23:00:00Z")).toBe("2026-09-23");
  });
  it("shows actual deadlines and signup dates, never pledge creation dates", () => {
    expect(individualCalendarEntries([{ id: "p1", need }], [{ id: "s1", event }]).map(({ details: _details, ...entry }) => entry)).toEqual([
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
  it("carries what the details dialog shows, including an embedded organisation", () => {
    const [entry] = individualCalendarEntries([], [{
      id: "s1",
      event: {
        ...event,
        end_time: "12:00",
        description: "Podjela obroka",
        requirements: "Udobna obuća",
        volunteers_needed: 8,
        volunteers_signed_up: 3,
        institution: [{ name: "Pučka kuhinja", address: "Ilica 1", city: "Zagreb" }],
      },
    }]);
    expect(entry.details).toEqual({
      subject: "volunteer",
      description: "Podjela obroka",
      startTime: "09:00",
      endTime: "12:00",
      requirements: "Udobna obuća",
      organisation: "Pučka kuhinja",
      location: "Ilica 1, Zagreb",
      filled: 3,
      needed: 8,
    });
    const [pledge] = individualCalendarEntries([{ id: "p1", quantity: 2, need: { ...need, quantity_needed: 10, quantity_pledged: 6 } }], []);
    expect(pledge.details).toMatchObject({ subject: "donation", filled: 6, needed: 10, mine: 2 });
  });
  it("keeps publication history when a need is fulfilled, without an active deadline", () => {
    expect(institutionCalendarEntries([{ ...need, is_fulfilled: true }], []).map((entry) => entry.kind)).toEqual(["publication"]);
  });
});
