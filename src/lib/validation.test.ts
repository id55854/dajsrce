import { describe, expect, it } from "vitest";
import { parseBoundedLimit, parseNeedInput, parseVolunteerEventInput } from "./validation";

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

  it("requires real event dates, valid times, and bounded capacity", () => {
    expect(
      parseVolunteerEventInput({
        title: "Volonterska akcija",
        event_date: "2026-02-30",
        start_time: "09:00",
        end_time: "08:00",
        volunteers_needed: 0,
      }).ok
    ).toBe(false);
    expect(
      parseVolunteerEventInput({
        title: "Volonterska akcija",
        event_date: "2026-08-20",
        start_time: "09:00",
        end_time: "12:30",
        volunteers_needed: 12,
      })
    ).toMatchObject({ ok: true });
  });

  it("rejects invalid query limits instead of relying on database behavior", () => {
    expect(parseBoundedLimit(null, 50, 100)).toEqual({ ok: true, value: 50 });
    expect(parseBoundedLimit("101", 50, 100)).toMatchObject({ ok: false });
    expect(parseBoundedLimit("NaN", 50, 100)).toMatchObject({ ok: false });
  });
});
