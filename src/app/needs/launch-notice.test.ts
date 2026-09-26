import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never),
}));

import { LocaleProvider } from "@/i18n/client";
import { LaunchNotice } from "./launch-notice";

function render(hasNeeds: boolean) {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      { initialLocale: "hr" } as ComponentProps<typeof LocaleProvider>,
      createElement(LaunchNotice, { hasNeeds })
    )
  );
}

describe("LaunchNotice", () => {
  it("explains an empty list honestly and offers the other ways to help", () => {
    const html = render(false);
    expect(html).toContain("Još nema objavljenih potreba");
    expect(html).toContain("udruge mu se ovih dana pridružuju");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/volunteer"');
  });

  it("asks associations to register, pre-selecting the association role", () => {
    const html = render(true);
    expect(html).toContain("Uskoro će ih biti više");
    expect(html).toContain("Predstavljate udrugu?");
    expect(html).toContain('href="/auth/register?role=ngo"');
  });
});
