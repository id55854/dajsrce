import { describe, expect, it } from "vitest";
import { capacityErrorCode } from "./capacity-errors";

describe("capacityErrorCode", () => {
  it("maps the transaction RPC conditions to stable codes", () => {
    expect(capacityErrorCode({ code: "23505", message: "already signed up" })).toBe("already_signed_up");
    expect(capacityErrorCode({ code: "23514", message: "event is full" })).toBe("event_full");
    expect(capacityErrorCode({ code: "23514", message: "event has ended" })).toBe("event_ended");
    expect(capacityErrorCode({ code: "23514", message: "need is already fulfilled" })).toBe("need_fulfilled");
    expect(capacityErrorCode({ code: "23514", message: "pledge exceeds remaining quantity" })).toBe("exceeds_remaining");
  });

  it("maps the per-account limit triggers", () => {
    for (const message of [
      "too many pledges today",
      "too many active pledges",
      "too many signups today",
      "too many active signups",
    ]) {
      expect(capacityErrorCode({ code: "23514", message })).toBe("account_limit");
    }
  });

  it("does not invent a reason for anything else", () => {
    expect(capacityErrorCode({ code: "23514", message: "something new" })).toBeNull();
    expect(capacityErrorCode({ code: "P0002", message: "event is full" })).toBeNull();
    expect(capacityErrorCode({})).toBeNull();
  });
});
