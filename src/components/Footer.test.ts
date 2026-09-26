import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/o-nama" }));

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) =>
    createElement("a", { href, className }, children),
}));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import { LocaleProvider } from "@/i18n/client";
import type { Locale } from "@/lib/types";
import { Footer, MapLegalStrip } from "./Footer";

function render(node: ReturnType<typeof createElement>, locale: Locale = "hr") {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      { initialLocale: locale } as ComponentProps<typeof LocaleProvider>,
      node
    )
  );
}

/** Every link in the markup, as href -> visible label. */
function links(html: string): Map<string, string> {
  return new Map(
    [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((match) => [match[1], match[2]])
  );
}

describe("legal links", () => {
  it("puts the about page and the three legal documents in the footer", () => {
    navigation.pathname = "/o-nama";
    const found = links(render(createElement(Footer)));

    expect(found.get("/o-nama")).toBe("O nama");
    expect(found.get("/pravila-privatnosti")).toBe("Pravila privatnosti");
    expect(found.get("/uvjeti-koristenja")).toBe("Uvjeti korištenja");
    expect(found.get("/kolacici")).toBe("Kolačići");
  });

  it("labels the same links in English", () => {
    navigation.pathname = "/doniraj";
    const found = links(render(createElement(Footer), "en"));

    expect(found.get("/pravila-privatnosti")).toBe("Privacy policy");
    expect(found.get("/uvjeti-koristenja")).toBe("Terms of use");
    expect(found.get("/kolacici")).toBe("Cookies");
  });

  it("keeps privacy and terms reachable from the map, which has no footer", () => {
    navigation.pathname = "/";
    expect(render(createElement(Footer))).toBe("");

    const found = links(render(createElement(MapLegalStrip)));
    expect(found.get("/o-nama")).toBe("O nama");
    expect(found.get("/pravila-privatnosti")).toBe("Privatnost");
    expect(found.get("/uvjeti-koristenja")).toBe("Uvjeti");
  });
});
