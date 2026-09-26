import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildMapQueryString, MAP_FEATURE_LIMIT, type PublicMapResponse } from "@/lib/location-map";
import { initialMapQuery } from "./map-state";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
import MapExperience from "./map-experience";
import { LocaleProvider } from "@/i18n/client";

const response: PublicMapResponse = {
  version: 2,
  features: [{
    kind: "cluster", id: "county:test", latitude: 45.5, longitude: 16,
    count: 123, bounds: [15, 45, 17, 46], hasUrgentNeed: false,
    placeKind: "county", placeName: "Županija <script>alert(1)</script>",
  }],
  meta: { returned: 1, totalMatches: 123, totalFeatures: 1, truncated: false, mode: "clusters", limit: MAP_FEATURE_LIMIT },
};

describe("server-rendered map bootstrap", () => {
  it("puts actual results in HTML before any effects or map JavaScript run", () => {
    const queryKey = buildMapQueryString(initialMapQuery(new URLSearchParams()));
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="hr"><MapExperience bootstrap={{ queryKey, response }} /></LocaleProvider>
    );
    expect(html).toContain("123");
    expect(html).toContain("Županija &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("Učitavanje udruga");
    // A single responsive result set, not two copies of the 60-row budget.
    expect(html.match(/Županija &lt;script&gt;/g)).toHaveLength(1);
  });

  it("keeps filters, multi-donation semantics and bounds in the server query", () => {
    const query = initialMapQuery(new URLSearchParams("categories=soup_kitchen&donationTypes=food,hygiene&city=Zagreb&onlyOnboarded=true&@=45.8,16,12"));
    expect(query.categories).toEqual(["soup_kitchen"]);
    // The catch-all is only a category outside the social view.
    expect(initialMapQuery(new URLSearchParams("categories=association&social=0")).categories)
      .toEqual(["association"]);
    expect(initialMapQuery(new URLSearchParams("categories=association")).categories)
      .not.toContain("association");
    expect(query.donationTypes).toEqual(["food", "hygiene"]);
    expect(query.city).toBe("Zagreb");
    expect(query.onlyOnboarded).toBe(true);
    expect(query.zoom).toBe(12);
    expect(query.limit).toBeLessThanOrEqual(200);
  });

  it("does not let an injected feature limit widen the server query", () => {
    const query = initialMapQuery(new URLSearchParams("limit=1000000&bbox=-180,-90,180,90"));
    expect(query.limit).toBe(MAP_FEATURE_LIMIT);
    expect(query.bbox).not.toEqual([-180, -90, 180, 90]);
  });
});
