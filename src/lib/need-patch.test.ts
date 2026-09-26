import { describe, expect, it } from "vitest";
import {
  NEW_NEED_DONATION_TYPES,
  isOpenForNewNeeds,
  needErrorKey,
  needFieldFromMessage,
  parseNeedPatch,
} from "./need-patch";

describe("parseNeedPatch", () => {
  it("accepts the editable fields and normalises them", () => {
    expect(
      parseNeedPatch({
        title: "  Zimske jakne ",
        description: "  ",
        urgency: "urgent",
        quantity_needed: "12",
        deadline: "2026-10-31",
        is_fulfilled: false,
      })
    ).toEqual({
      ok: true,
      value: {
        title: "Zimske jakne",
        description: null,
        urgency: "urgent",
        quantity_needed: 12,
        deadline: "2026-10-31",
        is_fulfilled: false,
      },
    });
  });

  it("lets a quantity target and a deadline be cleared", () => {
    expect(parseNeedPatch({ quantity_needed: null, deadline: "" })).toEqual({
      ok: true,
      value: { quantity_needed: null, deadline: null },
    });
  });

  it("closes or reopens with a real boolean only", () => {
    expect(parseNeedPatch({ is_fulfilled: true })).toEqual({ ok: true, value: { is_fulfilled: true } });
    expect(parseNeedPatch({ is_fulfilled: "true" })).toMatchObject({ ok: false, field: "is_fulfilled" });
  });

  it("never changes the donation type or anything outside the edit contract", () => {
    expect(parseNeedPatch({ donation_type: "money" })).toMatchObject({ ok: false, field: "donation_type" });
    for (const key of ["institution_id", "quantity_pledged", "id", "created_at"]) {
      expect(parseNeedPatch({ [key]: "x" })).toMatchObject({ ok: false, field: null });
    }
    expect(parseNeedPatch({}).ok).toBe(false);
    expect(parseNeedPatch(null).ok).toBe(false);
  });

  it.each([
    [{ title: "" }, "title"],
    [{ title: "x".repeat(161) }, "title"],
    [{ description: "x".repeat(4001) }, "description"],
    [{ urgency: "soon" }, "urgency"],
    [{ quantity_needed: 0 }, "quantity_needed"],
    [{ quantity_needed: 1.5 }, "quantity_needed"],
    [{ quantity_needed: 1_000_001 }, "quantity_needed"],
    [{ deadline: "2026-02-30" }, "deadline"],
  ])("names the field for %j", (patch, field) => {
    expect(parseNeedPatch(patch)).toMatchObject({ ok: false, field });
  });
});

describe("donation types for new needs", () => {
  it("leaves money out for launch and keeps every other type", () => {
    expect(isOpenForNewNeeds("money")).toBe(false);
    expect(isOpenForNewNeeds("food")).toBe(true);
    expect(NEW_NEED_DONATION_TYPES).not.toContain("money");
    expect(NEW_NEED_DONATION_TYPES).toContain("clothes");
  });
});

describe("need error messages", () => {
  it("reads the field out of a validation message", () => {
    expect(needFieldFromMessage("quantity_needed must be an integer between 1 and 1000000")).toBe("quantity_needed");
    expect(needFieldFromMessage("deadline must be a real YYYY-MM-DD date")).toBe("deadline");
    expect(needFieldFromMessage("donation_type is invalid")).toBe("donation_type");
    expect(needFieldFromMessage("Request body must be an object")).toBeNull();
  });

  it("maps codes and statuses to Croatian keys", () => {
    expect(needErrorKey({ status: 409, code: "quantity_below_pledged" }, "update")).toBe(
      "institution.need_error_below_pledged"
    );
    expect(needErrorKey({ status: 400, code: "donation_type_unavailable" }, "create")).toBe(
      "institution.need_error_money"
    );
    expect(needErrorKey({ status: 400, field: "title" }, "create")).toBe("institution.need_error_title");
    expect(needErrorKey({ status: 400, field: "nope" }, "create")).toBe("institution.need_error_invalid");
    expect(needErrorKey({ status: 403 }, "create")).toBe("institution.need_error_forbidden");
    expect(needErrorKey({ status: 429 }, "update")).toBe("auth.error_rate_limited");
    expect(needErrorKey({ status: 500 }, "create")).toBe("institution.dashboard_error_need_failed");
    expect(needErrorKey({ status: 503 }, "update")).toBe("institution.need_update_failed");
  });
});
