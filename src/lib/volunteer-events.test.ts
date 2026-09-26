import { describe, expect, it } from "vitest";
import {
  addressWithCity,
  hasVolunteerEventEnded,
  nearbyEventNotice,
  readableOrganisationName,
  splitByEventTime,
  volunteerEventPlace,
  zagrebTime,
  zagrebToday,
} from "./volunteer-events";

describe("Croatian calendar day and clock", () => {
  it("uses the Croatian date, not the UTC one, around midnight", () => {
    // 22:30 UTC in late September is 00:30 the next day in Zagreb (CEST).
    expect(zagrebToday(new Date("2026-09-26T22:30:00Z"))).toBe("2026-09-27");
    expect(zagrebToday(new Date("2026-09-26T21:30:00Z"))).toBe("2026-09-26");
    // Winter time is one hour ahead of UTC.
    expect(zagrebToday(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });

  it("reads the wall clock on a 24-hour dial", () => {
    expect(zagrebTime(new Date("2026-09-26T22:30:00Z"))).toBe("00:30");
    expect(zagrebTime(new Date("2026-09-26T10:05:00Z"))).toBe("12:05");
  });
});

describe("hasVolunteerEventEnded", () => {
  const noon = new Date("2026-09-26T10:00:00Z"); // 12:00 in Zagreb

  it("treats earlier days as over and later days as upcoming", () => {
    expect(hasVolunteerEventEnded({ event_date: "2026-09-25", end_time: "23:00:00" }, noon)).toBe(true);
    expect(hasVolunteerEventEnded({ event_date: "2026-09-27", end_time: "08:00:00" }, noon)).toBe(false);
  });

  it("closes a same-day event once its end time has passed", () => {
    expect(hasVolunteerEventEnded({ event_date: "2026-09-26", end_time: "11:59:00" }, noon)).toBe(true);
    expect(hasVolunteerEventEnded({ event_date: "2026-09-26", end_time: "12:00" }, noon)).toBe(true);
    expect(hasVolunteerEventEnded({ event_date: "2026-09-26", end_time: "12:01:00" }, noon)).toBe(false);
  });

  it("keeps a same-day event without an end time open all day", () => {
    expect(hasVolunteerEventEnded({ event_date: "2026-09-26", end_time: null }, noon)).toBe(false);
  });
});

describe("splitByEventTime", () => {
  const noon = new Date("2026-09-26T10:00:00Z"); // 12:00 in Zagreb
  const row = (id: string, event_date: string, start_time: string, end_time: string) => ({
    id,
    event: { event_date, start_time, end_time },
  });

  it("orders upcoming soonest first and past latest first", () => {
    const { upcoming, past } = splitByEventTime([
      row("later", "2026-10-05", "09:00:00", "12:00:00"),
      row("old", "2026-09-01", "09:00:00", "12:00:00"),
      row("soon-afternoon", "2026-09-27", "15:00:00", "17:00:00"),
      row("soon-morning", "2026-09-27", "08:00:00", "10:00:00"),
      row("older", "2026-08-15", "09:00:00", "12:00:00"),
    ], noon);
    expect(upcoming.map((signup) => signup.id)).toEqual(["soon-morning", "soon-afternoon", "later"]);
    expect(past.map((signup) => signup.id)).toEqual(["old", "older"]);
  });

  it("counts today's event as past once it has ended, and as upcoming until then", () => {
    const { upcoming, past } = splitByEventTime([
      row("this-morning", "2026-09-26", "08:00:00", "11:00:00"),
      row("this-afternoon", "2026-09-26", "14:00:00", "16:00:00"),
      row("right-now", "2026-09-26", "11:00:00", "13:00:00"),
    ], noon);
    expect(upcoming.map((signup) => signup.id)).toEqual(["right-now", "this-afternoon"]);
    expect(past.map((signup) => signup.id)).toEqual(["this-morning"]);
  });

  it("puts a signup whose event cannot be read with the past ones", () => {
    expect(splitByEventTime([{ id: "gone", event: null }], noon).past).toHaveLength(1);
  });
});

describe("event place", () => {
  it("does not repeat a city the address already names", () => {
    expect(addressWithCity("Rebro 38/16, Sesvete", "Sesvete")).toBe("Rebro 38/16, Sesvete");
    expect(addressWithCity("Ilica 1, 10000 ZAGREB", "Zagreb")).toBe("Ilica 1, 10000 ZAGREB");
    expect(addressWithCity("Ilica 1", "Zagreb")).toBe("Ilica 1, Zagreb");
  });

  it("matches the city as a whole word only", () => {
    expect(addressWithCity("Zagrebačka 5", "Zagreb")).toBe("Zagrebačka 5, Zagreb");
    expect(addressWithCity("Trg Sv. Nedelje 1", "Sv. Nedelja")).toBe("Trg Sv. Nedelje 1, Sv. Nedelja");
  });

  it("falls back to whatever part is present", () => {
    expect(addressWithCity(null, "Split")).toBe("Split");
    expect(addressWithCity("Ulica 2", "")).toBe("Ulica 2");
    expect(addressWithCity(undefined, undefined)).toBe("");
  });

  it("prefers the place the organisation typed for the event", () => {
    expect(volunteerEventPlace("Park Maksimir, glavni ulaz", "Ilica 1", "Zagreb")).toBe("Park Maksimir, glavni ulaz");
    expect(volunteerEventPlace("   ", "Ilica 1", "Zagreb")).toBe("Ilica 1, Zagreb");
  });
});

describe("readableOrganisationName", () => {
  it("recases a register name written in capitals", () => {
    expect(readableOrganisationName("UDRUGA ZA DIGITALNU SOLIDARNOST DAJSRCE")).toBe(
      "Udruga za Digitalnu Solidarnost Dajsrce"
    );
    expect(readableOrganisationName("HRVATSKI CRVENI KRIŽ - GRADSKO DRUŠTVO CRVENOG KRIŽA ZAGREB")).toBe(
      "Hrvatski Crveni Križ - Gradsko Društvo Crvenog Križa Zagreb"
    );
  });

  it("keeps abbreviations and the first word capitalised", () => {
    expect(readableOrganisationName("DVD SESVETE")).toBe("DVD Sesvete");
    expect(readableOrganisationName("U SRCU ZAJEDNICE")).toBe("U Srcu Zajednice");
  });

  it("leaves a name typed in mixed case alone", () => {
    expect(readableOrganisationName("Udruga Srce i ruke")).toBe("Udruga Srce i ruke");
    expect(readableOrganisationName("  udruga   mala  ")).toBe("udruga mala");
  });
});

describe("nearbyEventNotice", () => {
  it("speaks Croatian and does not shout the register name", () => {
    expect(nearbyEventNotice("UDRUGA ZA DIGITALNU SOLIDARNOST DAJSRCE", "Čišćenje parka", "2026-10-01")).toEqual({
      title: "Volonterski događaj: Čišćenje parka",
      body: 'Udruga za Digitalnu Solidarnost Dajsrce u vašoj blizini traži volontere za "Čišćenje parka" 1. listopada 2026.',
    });
  });

  it("names a generic organiser when the name is missing", () => {
    expect(nearbyEventNotice(null, "Akcija", "2026-12-24").body).toBe(
      'Udruga u vašoj blizini traži volontere za "Akcija" 24. prosinca 2026.'
    );
  });
});
