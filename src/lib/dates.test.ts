import { describe, expect, it } from "vitest";
import { parseISODate, utcPeriodBounds } from "./dates";

describe("parseISODate", () => {
  it("accepts real Gregorian dates, including leap days", () => {
    expect(parseISODate("2024-02-29")).toBe("2024-02-29");
    expect(parseISODate("2026-08-01")).toBe("2026-08-01");
  });

  it("rejects normalized, partial, and non-string dates", () => {
    expect(parseISODate("2025-02-29")).toBeNull();
    expect(parseISODate("2026-04-31")).toBeNull();
    expect(parseISODate("2026-8-01")).toBeNull();
    expect(parseISODate("2026-08-01T00:00:00Z")).toBeNull();
    expect(parseISODate(null)).toBeNull();
  });
});

describe("utcPeriodBounds", () => {
  it("uses inclusive UTC day boundaries", () => {
    expect(utcPeriodBounds("2026-01-01", "2026-12-31")).toEqual({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-12-31T23:59:59.999Z",
    });
  });
});
