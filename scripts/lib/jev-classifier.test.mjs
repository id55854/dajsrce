import { describe, expect, it } from "vitest";
import {
  AUTO_PUBLISH_CONFIDENCE,
  CATEGORIES,
  JEV_CLASSIFICATION_VERSION,
  jevState,
  toClassification,
} from "./jev-classifier.mjs";

const row = {
  udr_id: "12345",
  naziv: "UDRUGA OBOLJELIH OD DIJABETESA",
  ciljevi: "Pomoć oboljelima od šećerne bolesti",
  opis_djelatnosti: "Edukacija i podrška oboljelima",
  ciljane_skupine: "OSOBE KOJE BOLUJU OD KRONIČNIH BOLESTI",
};

const answer = (choice, confidence, probabilities) => ({
  choice,
  confidence,
  model: "jev-1.13.0",
  probabilities: probabilities ?? { [choice]: confidence, association: 1 - confidence },
});

describe("toClassification", () => {
  it("auto-publishes a confident care category and stamps the Jev version", () => {
    const result = toClassification(row, answer("medical_patient_support", 0.93));
    expect(result).toMatchObject({
      udr_id: "12345",
      mapped_category: "medical_patient_support",
      classification_status: "auto_eligible",
      classification_version: JEV_CLASSIFICATION_VERSION,
      mapped_rule: "jev:jev-1.13.0",
    });
    expect(result.classification_candidates[0]).toEqual({ category: "medical_patient_support", probability: 0.93 });
  });

  it("sends a low-confidence care answer to review instead of the map", () => {
    const result = toClassification(row, answer("social_welfare", AUTO_PUBLISH_CONFIDENCE - 0.01));
    expect(result.classification_status).toBe("needs_review");
    expect(result.mapped_category).toBe("social_welfare");
  });

  it("keeps excluded entity shapes in review whatever the model says", () => {
    const result = toClassification({ ...row, naziv: "KOŠARKAŠKI KLUB INVALIDA SPLIT" }, answer("disability_support", 0.99));
    expect(result.classification_status).toBe("needs_review");
    expect(result.classification_reasons).toContain("excluded entity type requires human review");
  });

  it("maps a clear association answer to unmapped with no category or donation candidates", () => {
    const result = toClassification(row, answer("association", 0.97));
    expect(result).toMatchObject({ mapped_category: null, classification_status: "unmapped", donation_candidates: [] });
  });

  it("reviews an uncertain association answer that leaves room for a care category", () => {
    const result = toClassification(
      row,
      answer("association", 0.3, { association: 0.45, social_welfare: 0.4, elderly_care: 0.15 })
    );
    expect(result.classification_status).toBe("needs_review");
    expect(result.mapped_category).toBeNull();
    expect(result.classification_reasons[0]).toContain("social_welfare");
  });
});

describe("jevState", () => {
  it("clips long statute text and marks missing fields", () => {
    const state = jevState({ naziv: "X", ciljevi: "a ".repeat(2000), opis_djelatnosti: "", ciljane_skupine: null });
    expect(state.goals.length).toBeLessThanOrEqual(701);
    expect(state.activities).toBe("(not stated)");
    expect(state.target_groups).toBe("(not stated)");
  });

  it("only offers categories the app knows", () => {
    expect(CATEGORIES).toContain("association");
    expect(CATEGORIES).toHaveLength(13);
  });
});
