import { describe, expect, it } from "vitest";
import { basemapLayer, normalizeCartoApiKey } from "@/lib/basemap";

describe("basemap selection", () => {
  it("uses CARTO with the key as a query parameter when one is configured", () => {
    const light = basemapLayer(false, "abcDEF1234567890xyz");
    expect(light.provider).toBe("carto");
    expect(light.url).toBe(
      "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=abcDEF1234567890xyz"
    );
    expect(light.attribution).toContain("carto.com/attributions");
    expect(light.className).toBe("");

    const dark = basemapLayer(true, "abcDEF1234567890xyz");
    expect(dark.url).toContain("/dark_all/");
    // The dark CARTO style is a real style, not a filter.
    expect(dark.className).toBe("");
  });

  it("falls back to OpenStreetMap without a key, and filters it for dark mode", () => {
    const light = basemapLayer(false, null);
    expect(light.provider).toBe("openstreetmap");
    expect(light.url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(light.url).not.toContain("{s}");
    expect(light.url).not.toContain("{r}");
    expect(light.attribution).toContain("openstreetmap.org/copyright");
    expect(light.attribution).not.toContain("carto");
    expect(light.className).toBe("");

    expect(basemapLayer(true, null).className).toBe("map-tiles-dark");
  });

  it("never sends a watermarked CARTO request", () => {
    // The pre-key URLs were `{s}.basemaps.cartocdn.com/...` with no key.
    for (const dark of [false, true]) {
      const layer = basemapLayer(dark, null);
      expect(layer.url).not.toContain("cartocdn.com");
    }
  });

  it("treats blank or malformed keys as absent", () => {
    expect(normalizeCartoApiKey(undefined)).toBeNull();
    expect(normalizeCartoApiKey("")).toBeNull();
    expect(normalizeCartoApiKey("   ")).toBeNull();
    expect(normalizeCartoApiKey("short")).toBeNull();
    expect(normalizeCartoApiKey("has spaces in it 1234567")).toBeNull();
    expect(normalizeCartoApiKey("your_carto_api_key")).toBe("your_carto_api_key");
    expect(normalizeCartoApiKey("  abcDEF1234567890xyz \n")).toBe("abcDEF1234567890xyz");
  });
});
