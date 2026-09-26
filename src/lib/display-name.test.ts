import { describe, expect, it } from "vitest";
import { displayOrganisationName } from "./display-name";

describe("displayOrganisationName", () => {
  it("turns a register name in capitals into Croatian sentence case", () => {
    expect(displayOrganisationName("UDRUGA ZA DIGITALNU SOLIDARNOST DAJSRCE")).toBe(
      "Udruga za digitalnu solidarnost dajsrce"
    );
    expect(displayOrganisationName("CARITAS ZAGREBAČKE NADBISKUPIJE")).toBe("Caritas zagrebačke nadbiskupije");
  });

  it("capitalises the organisation's own name inside opening quotes only", () => {
    expect(displayOrganisationName('UDRUGA ZA POMOĆ "SRCE" ZAGREB')).toBe('Udruga za pomoć "Srce" zagreb');
    expect(displayOrganisationName("KLUB „NADA“ SPLIT")).toBe("Klub „Nada“ split");
  });

  it("keeps abbreviations and numbers as written", () => {
    expect(displayOrganisationName("DVD SESVETE")).toBe("DVD sesvete");
    expect(displayOrganisationName("UDRUGA 2. BRIGADA")).toBe("Udruga 2. brigada");
  });

  it("leaves a name a person already wrote in mixed case, and tidies whitespace", () => {
    expect(displayOrganisationName("Crveni križ Zagreb")).toBe("Crveni križ Zagreb");
    expect(displayOrganisationName("  Udruga   Srce ")).toBe("Udruga Srce");
    expect(displayOrganisationName("")).toBe("");
    expect(displayOrganisationName(null)).toBe("");
  });
});
