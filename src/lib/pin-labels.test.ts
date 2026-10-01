import { describe, expect, it } from "vitest";
import { planPinLabels } from "./pin-labels";

const viewport = { width: 800, height: 600 };

function pin(id: string, x: number, y: number, priority = 4, labelWidth = 120) {
  return { id, x, y, size: 32, priority, labelWidth };
}

describe("planPinLabels", () => {
  it("labels well separated pins", () => {
    const labels = planPinLabels([pin("a", 200, 300), pin("b", 600, 300)], viewport);
    expect([...labels].sort()).toEqual(["a", "b"]);
  });

  it("gives the space to the higher priority pin when two labels collide", () => {
    const labels = planPinLabels([pin("registry", 300, 300, 4), pin("verified", 380, 300, 1)], viewport);
    expect([...labels]).toEqual(["verified"]);
  });

  it("does not let a label cover another pin", () => {
    // "b" sits right where "a"'s label would go.
    const labels = planPinLabels([pin("a", 400, 300, 1), pin("b", 400, 260, 4, 20)], viewport);
    expect(labels.has("a")).toBe(false);
  });

  it("labels nothing in a crowded neighbourhood", () => {
    const crowd = [0, 1, 2, 3, 4].map((index) => pin(`p${index}`, 400 + index * 7, 300 + index * 7, 4, 30));
    expect(planPinLabels(crowd, viewport).size).toBe(0);
  });

  it("skips a label that would leave the map", () => {
    const labels = planPinLabels([pin("edge", 20, 300), pin("top", 400, 30)], viewport);
    expect(labels.size).toBe(0);
  });
});
