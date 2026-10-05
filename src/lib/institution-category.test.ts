import { describe, expect, it } from "vitest";
import {
  SELF_SERVICE_CATEGORIES,
  categoryRequestErrorStatus,
  institutionTypeLabel,
  normalizeCategoryLabel,
  parseCategoryRequestReviewInput,
} from "./institution-category";

describe("SELF_SERVICE_CATEGORIES", () => {
  it("lists the social categories an organisation may choose itself", () => {
    expect(SELF_SERVICE_CATEGORIES).toContain("elderly_care");
    expect(SELF_SERVICE_CATEGORIES).not.toContain("association");
    expect(SELF_SERVICE_CATEGORIES).not.toContain("domestic_violence");
    expect(SELF_SERVICE_CATEGORIES).toHaveLength(11);
  });
});

describe("normalizeCategoryLabel", () => {
  it("trims and collapses whitespace within the limits", () => {
    expect(normalizeCategoryLabel("  Dnevni \n boravak  ")).toBe("Dnevni boravak");
    expect(normalizeCategoryLabel("ab")).toBe("ab");
    expect(normalizeCategoryLabel("a")).toBeNull();
    expect(normalizeCategoryLabel("x".repeat(81))).toBeNull();
    expect(normalizeCategoryLabel(42)).toBeNull();
  });
});

describe("institutionTypeLabel", () => {
  it("prefers the approved own type, else the category's name", () => {
    expect(institutionTypeLabel({ category: "elderly_care", categoryLabel: "Dnevni boravak" }, "hr")).toBe(
      "Dnevni boravak"
    );
    expect(institutionTypeLabel({ category: "elderly_care", categoryLabel: null }, "hr")).toBe(
      "Skrb za starije"
    );
    expect(institutionTypeLabel({ category: "elderly_care" }, "en")).toBe("Elderly care");
  });
});

describe("parseCategoryRequestReviewInput", () => {
  it("accepts an approval with a listed category and a trimmed note", () => {
    expect(parseCategoryRequestReviewInput({ decision: "approve", category: "caritas", note: " ok " })).toEqual({
      ok: true,
      value: { decision: "approve", category: "caritas", note: "ok" },
    });
    expect(parseCategoryRequestReviewInput({ decision: "approve" })).toEqual({
      ok: true,
      value: { decision: "approve", category: null, note: null },
    });
  });

  it("ignores a category on a rejection", () => {
    expect(parseCategoryRequestReviewInput({ decision: "reject", category: "caritas", note: "Ne" })).toEqual({
      ok: true,
      value: { decision: "reject", category: null, note: "Ne" },
    });
  });

  it("refuses unknown decisions, categories outside the list and long notes", () => {
    expect(parseCategoryRequestReviewInput({ decision: "maybe" }).ok).toBe(false);
    expect(parseCategoryRequestReviewInput({ decision: "approve", category: "domestic_violence" }).ok).toBe(false);
    expect(parseCategoryRequestReviewInput({ decision: "approve", category: "association" }).ok).toBe(false);
    expect(parseCategoryRequestReviewInput({ decision: "reject", note: "x".repeat(1001) }).ok).toBe(false);
    expect(parseCategoryRequestReviewInput(null).ok).toBe(false);
  });
});

describe("categoryRequestErrorStatus", () => {
  it("maps database error codes", () => {
    expect(categoryRequestErrorStatus("42501")).toBe(403);
    expect(categoryRequestErrorStatus("P0002")).toBe(404);
    expect(categoryRequestErrorStatus("22023")).toBe(400);
    expect(categoryRequestErrorStatus("P0001")).toBe(409);
    expect(categoryRequestErrorStatus(undefined)).toBe(500);
  });
});
