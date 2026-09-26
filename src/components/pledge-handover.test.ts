import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never),
}));

import { LocaleProvider } from "@/i18n/client";
import { PledgeHandover, type PledgeHandoverInstitution } from "./PledgeDetailsDialog";

function render(institution: PledgeHandoverInstitution | null) {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      { initialLocale: "hr" } as ComponentProps<typeof LocaleProvider>,
      createElement(PledgeHandover, { institution })
    )
  );
}

const base: PledgeHandoverInstitution = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Udruga",
  address: "Ilica 1",
  city: "Zagreb",
  is_location_hidden: false,
};

describe("PledgeHandover", () => {
  it("tells the donor the next step and lists every published way to reach the organisation", () => {
    const html = render({
      ...base,
      phone: "+385 1 234 5678",
      email: "kontakt@udruga.hr",
      website: "www.udruga.hr",
      drop_off_hours: "utorkom 10–14 h, ulaz iz dvorišta",
    });
    expect(html).toContain("Javite se udruzi i dogovorite predaju.");
    expect(html).toContain('href="tel:+38512345678"');
    expect(html).toContain('href="mailto:kontakt@udruga.hr"');
    expect(html).toContain('href="https://www.udruga.hr"');
    expect(html).toContain("Ilica 1, Zagreb");
    expect(html).toContain("utorkom 10–14 h, ulaz iz dvorišta");
  });

  it("names a hidden location's area once and says the address is not public", () => {
    const html = render({ ...base, address: "Zagreb", city: "Zagreb", is_location_hidden: true, phone: "01 234 5678" });
    expect(html).toContain("Područje");
    expect(html).not.toContain("Zagreb, Zagreb");
    expect(html).toContain("Točna adresa nije javna");
  });

  it("points to the public profile when no contact is published, and never links an unsafe website", () => {
    const html = render({ ...base, website: "javascript:alert(1)" });
    expect(html).not.toContain("javascript:");
    expect(html).toContain("još nije objavila kontakt");
    expect(html).toContain(`href="/institution/${base.id}"`);
  });

  it("still gives the next step without any organisation details", () => {
    expect(render(null)).toContain("Javite se udruzi i dogovorite predaju.");
  });
});
