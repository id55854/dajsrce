import { describe, expect, it } from "vitest";
import { decideSheetGesture } from "./Sheet";

const base = { atFullDetent: false, contentAtTop: true };

describe("decideSheetGesture", () => {
  it("waits until the movement passes the slop", () => {
    expect(decideSheetGesture({ ...base, dx: 4, dy: -6 })).toBe("pending");
    expect(decideSheetGesture({ ...base, dx: 0, dy: -7 })).toBe("sheet");
  });

  it("leaves sideways and diagonal-leaning movement to the content", () => {
    expect(decideSheetGesture({ ...base, dx: 20, dy: -3 })).toBe("native");
    expect(decideSheetGesture({ ...base, dx: -10, dy: 10 })).toBe("native");
  });

  it("moves the sheet both ways below the top detent, even over scrolled content", () => {
    expect(decideSheetGesture({ ...base, dx: 1, dy: -12 })).toBe("sheet");
    expect(decideSheetGesture({ ...base, dx: 1, dy: 12 })).toBe("sheet");
    expect(decideSheetGesture({ ...base, contentAtTop: false, dx: 0, dy: -12 })).toBe("sheet");
  });

  it("scrolls the content at the top detent unless pulled down from its top", () => {
    const full = { atFullDetent: true, contentAtTop: true };
    expect(decideSheetGesture({ ...full, dx: 0, dy: -12 })).toBe("native");
    expect(decideSheetGesture({ ...full, dx: 0, dy: 12 })).toBe("sheet");
    expect(decideSheetGesture({ ...full, contentAtTop: false, dx: 0, dy: 12 })).toBe("native");
  });
});
