import { describe, expect, it } from "vitest";
import { addressWithCity } from "./utils";

describe("addressWithCity", () => {
  it("appends the city only when the address does not already name it", () => {
    expect(addressWithCity("Rebro 38/16, Sesvete", "Sesvete")).toBe("Rebro 38/16, Sesvete");
    expect(addressWithCity("Unska ulica 3, ZAGREB", "Zagreb")).toBe("Unska ulica 3, ZAGREB");
    expect(addressWithCity("Ilica 1", "Zagreb")).toBe("Ilica 1, Zagreb");
    // Diacritics do not defeat the match, and a postcode may precede the city.
    expect(addressWithCity("Trg 1, Sibenik", "Šibenik")).toBe("Trg 1, Sibenik");
    expect(addressWithCity("Rebro 38/16, 10360 Sesvete", "Sesvete")).toBe("Rebro 38/16, 10360 Sesvete");
    // A street named after its city is not the city.
    expect(addressWithCity("Splitska 5", "Split")).toBe("Splitska 5, Split");
    expect(addressWithCity("Zagrebačka 12", "Zagreb")).toBe("Zagrebačka 12, Zagreb");
  });

  it("never renders a dangling separator", () => {
    expect(addressWithCity(null, "Zagreb")).toBe("Zagreb");
    expect(addressWithCity("  ", "Zagreb")).toBe("Zagreb");
    expect(addressWithCity("Ilica 1", null)).toBe("Ilica 1");
    expect(addressWithCity(null, null)).toBe("");
  });
});
