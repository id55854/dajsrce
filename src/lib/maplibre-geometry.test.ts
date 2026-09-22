import { describe, expect, it } from "vitest";
import { hiddenArea, toMapZoom, toPublicZoom } from "./maplibre-geometry";
import { clusterCaptionHtml } from "./map-marker-html";

describe("MapLibre migration", () => {
  it("preserves the existing URL/API zoom scale and clamps supported levels", () => {
    for (const zoom of [6, 7, 12, 14, 19]) expect(toPublicZoom(toMapZoom(zoom))).toBe(zoom);
    expect(toMapZoom(99)).toBe(18);
    expect(toMapZoom(-1)).toBe(5);
  });
  it("draws a closed safety area in longitude/latitude order, never an exact point", () => {
    const area = hiddenArea({ id: "hidden", latitude: 45.8, longitude: 16 }, "#ef4444", true);
    const ring = area.geometry.coordinates[0];
    expect(ring).toHaveLength(65);
    expect(ring[0][0]).toBeCloseTo(16);
    expect(ring[0][1]).toBeGreaterThan(45.81);
    expect(ring[0][0]).toBeCloseTo(ring[64][0]);
    expect(ring[0][1]).toBeCloseTo(ring[64][1]);
    expect(area.properties).toEqual({ id: "hidden", color: "#ef4444", selected: true });
  });
  it("escapes untrusted place names in marker captions", () => {
    const html = clusterCaptionHtml('<img src=x onerror=alert(1)> &', 42);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&amp;');
  });
});
