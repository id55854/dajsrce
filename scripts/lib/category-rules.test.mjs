import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_VERSION,
  inferAcceptsDonations,
  parseSjediste,
  scoreRow,
} from "./category-rules.mjs";

describe("registry classification", () => {
  it("auto-classifies strong support-provider signals", () => {
    const result = scoreRow({
      name: "Udruga za podršku osobama s invaliditetom",
      groups: "OSOBE S INVALIDITETOM",
      text: "inkluzija i dnevni boravak za osobe s invaliditetom",
    });
    expect(result.category).toBe("disability_support");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.classificationStatus).toBe("auto_eligible");
    expect(result.classificationVersion).toBe(CLASSIFICATION_VERSION);
  });

  it.each([
    "Konjički klub osoba s invaliditetom",
    "Kulturno umjetničko društvo umirovljenika",
    "Nogometni klub za mlade s teškoćama",
  ])("never auto-publishes excluded entity shapes: %s", (name) => {
    const result = scoreRow({
      name,
      groups: "OSOBE S INVALIDITETOM, OSOBE STARIJE ŽIVOTNE DOBI",
      text: "inkluzija i humanitarna pomoć",
    });
    expect(result.classificationStatus).not.toBe("auto_eligible");
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("keeps inferred donation types as explicit evidence-based candidates", () => {
    expect(inferAcceptsDonations("social_welfare", "")).toEqual([]);
    expect(inferAcceptsDonations(null, "Prikupljamo hranu, pelene i školski pribor")).toEqual(
      expect.arrayContaining(["food", "hygiene", "toys_books"])
    );
  });

  it("parses the last comma as the city boundary", () => {
    expect(parseSjediste("Ulica grada Vukovara 1, Zagreb")).toEqual({
      street: "Ulica grada Vukovara 1",
      city: "Zagreb",
    });
  });
});
