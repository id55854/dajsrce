import { expect, it } from "vitest";
import { basemapStyle } from "./basemap";

it("uses separate vector styles for light and dark themes without an API key", () => {
  expect(basemapStyle(false)).toBe("https://tiles.openfreemap.org/styles/liberty");
  expect(basemapStyle(true)).toBe("https://tiles.openfreemap.org/styles/dark");
});
