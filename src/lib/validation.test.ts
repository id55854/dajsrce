import { describe, expect, it } from "vitest";
import {
  parseBoundedLimit,
  parseNeedInput,
  parseVolunteerEventInput,
  parseVolunteerEventPatch,
} from "./validation";

// Pinned so the event-date rule does not depend on when the suite runs.
const TODAY = { today: "2026-08-01" };
const EVENT = {
  title: "Volonterska akcija",
  event_date: "2026-08-20",
  start_time: "09:00",
  end_time: "12:30",
  volunteers_needed: 12,
};

describe("HTTP input validation", () => {
  it("accepts and normalizes valid need input", () => {
    expect(
      parseNeedInput({
        title: "  Hrana za obitelji  ",
        description: " ",
        donation_type: "food",
        urgency: "urgent",
        quantity_needed: "25",
      })
    ).toEqual({
      ok: true,
      value: {
        title: "Hrana za obitelji",
        description: null,
        donation_type: "food",
        urgency: "urgent",
        quantity_needed: 25,
        deadline: null,
      },
    });
  });

  it.each([
    [{ title: "", donation_type: "food" }, "title"],
    [{ title: "Test", donation_type: "anything" }, "donation_type"],
    [{ title: "Test", donation_type: "food", quantity_needed: -1 }, "quantity_needed"],
    [{ title: "Test", donation_type: "food", urgency: "critical" }, "urgency"],
  ])("rejects invalid need fields", (input, expected) => {
    const result = parseNeedInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(expected as string);
  });

  it("accepts optional deadlines and rejects impossible dates", () => {
    const need = { title: "Test", donation_type: "food" };
    expect(parseNeedInput({ ...need, deadline: "2028-02-29" })).toMatchObject({ ok: true, value: { deadline: "2028-02-29" } });
    expect(parseNeedInput({ ...need, deadline: "2026-02-29" }).ok).toBe(false);
    expect(parseNeedInput({ ...need, deadline: "2026-09-25T00:00:00Z" }).ok).toBe(false);
    expect(parseNeedInput({ ...need, deadline: "" })).toMatchObject({ ok: true, value: { deadline: null } });
  });

  it("requires real event dates, valid times, and bounded capacity", () => {
    expect(
      parseVolunteerEventInput({
        title: "Volonterska akcija",
        event_date: "2026-02-30",
        start_time: "09:00",
        end_time: "08:00",
        volunteers_needed: 0,
      }, TODAY).ok
    ).toBe(false);
    expect(parseVolunteerEventInput(EVENT, TODAY)).toMatchObject({ ok: true });
  });

  it("names the field that failed so the form can explain it", () => {
    expect(parseVolunteerEventInput({ ...EVENT, end_time: "08:00" }, TODAY)).toMatchObject({ ok: false, field: "end_time" });
    expect(parseVolunteerEventInput({ ...EVENT, volunteers_needed: 0 }, TODAY)).toMatchObject({ ok: false, field: "volunteers_needed" });
    expect(parseVolunteerEventInput({ ...EVENT, title: " " }, TODAY)).toMatchObject({ ok: false, field: "title" });
    expect(parseVolunteerEventInput([], TODAY)).toMatchObject({ ok: false, field: null });
  });

  it("rejects an event dated before today in Croatia, but accepts today", () => {
    expect(parseVolunteerEventInput({ ...EVENT, event_date: "2026-07-31" }, TODAY)).toMatchObject({
      ok: false,
      field: "event_date",
      error: "event_date must not be in the past",
    });
    expect(parseVolunteerEventInput({ ...EVENT, event_date: "2026-08-01" }, TODAY)).toMatchObject({ ok: true });
  });

  it("accepts and trims what volunteers need to know and whom to call", () => {
    const result = parseVolunteerEventInput({
      ...EVENT,
      requirements: "  Udobna obuća i rukavice ",
      contact_person: " Ana Horvat ",
      contact_phone: " +385 (1) 234-5678 ",
    }, TODAY);
    expect(result).toMatchObject({
      ok: true,
      value: {
        requirements: "Udobna obuća i rukavice",
        contact_person: "Ana Horvat",
        contact_phone: "+385 (1) 234-5678",
      },
    });
    expect(parseVolunteerEventInput({ ...EVENT, contact_person: "", contact_phone: "" }, TODAY)).toMatchObject({
      ok: true,
      value: { contact_person: null, contact_phone: null, requirements: null },
    });
  });

  it.each([
    ["01 234 567a", "letters"],
    ["12345", "too short"],
    ["+ ( ) / - .", "no digits"],
    ["1".repeat(41), "too long"],
  ])("rejects the contact phone %s (%s)", (contactPhone) => {
    expect(parseVolunteerEventInput({ ...EVENT, contact_phone: contactPhone }, TODAY)).toMatchObject({
      ok: false,
      field: "contact_phone",
    });
  });

  it("bounds the contact person", () => {
    expect(parseVolunteerEventInput({ ...EVENT, contact_person: "A".repeat(121) }, TODAY)).toMatchObject({
      ok: false,
      field: "contact_person",
    });
  });

  it("rejects invalid query limits instead of relying on database behavior", () => {
    expect(parseBoundedLimit(null, 50, 100)).toEqual({ ok: true, value: 50 });
    expect(parseBoundedLimit("101", 50, 100)).toMatchObject({ ok: false });
    expect(parseBoundedLimit("NaN", 50, 100)).toMatchObject({ ok: false });
  });
});

describe("volunteer event edits", () => {
  it("accepts only the fields being changed, with the creation rules", () => {
    expect(parseVolunteerEventPatch({ title: " Novi naziv ", description: null }, TODAY)).toEqual({
      ok: true,
      value: { title: "Novi naziv", description: null },
    });
    expect(parseVolunteerEventPatch({ volunteers_needed: "8" }, TODAY)).toEqual({
      ok: true,
      value: { volunteers_needed: 8 },
    });
  });

  it("clears an optional field with an empty value", () => {
    expect(parseVolunteerEventPatch({ contact_phone: "", location: "  " }, TODAY)).toEqual({
      ok: true,
      value: { contact_phone: null, location: null },
    });
  });

  it("refuses required fields cleared, past dates and inverted times", () => {
    expect(parseVolunteerEventPatch({ title: null }, TODAY)).toMatchObject({ ok: false, field: "title" });
    expect(parseVolunteerEventPatch({ event_date: "2026-07-01" }, TODAY)).toMatchObject({ ok: false, field: "event_date" });
    expect(parseVolunteerEventPatch({ start_time: "10:00", end_time: "09:00" }, TODAY)).toMatchObject({
      ok: false,
      field: "end_time",
    });
    // One time alone is compared with the stored other by the transaction.
    expect(parseVolunteerEventPatch({ end_time: "09:00" }, TODAY)).toMatchObject({ ok: true });
  });

  it("never lets an edit reach the institution, the counters or the id", () => {
    for (const key of ["institution_id", "volunteers_signed_up", "id", "created_at"]) {
      expect(parseVolunteerEventPatch({ title: "Naziv", [key]: "x" }, TODAY)).toMatchObject({ ok: false, field: null });
    }
    expect(parseVolunteerEventPatch({}, TODAY)).toMatchObject({ ok: false, error: "Nothing to change" });
    expect(parseVolunteerEventPatch("title", TODAY)).toMatchObject({ ok: false });
  });
});
