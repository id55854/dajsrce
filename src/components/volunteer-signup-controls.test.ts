import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never),
}));

import { LocaleProvider } from "@/i18n/client";
import { ToastProvider } from "@/components/ui";
import { VolunteerSignupControls, volunteerEventReturnPath } from "./VolunteerEventCard";

function render(props: Partial<ComponentProps<typeof VolunteerSignupControls>>) {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      { initialLocale: "hr" } as ComponentProps<typeof LocaleProvider>,
      createElement(
        ToastProvider,
        null,
        createElement(VolunteerSignupControls, {
          confirmed: false,
          onConfirmedChange: () => {},
          onJoin: () => {},
          ...props,
        })
      )
    )
  );
}

/** Whether the join button, found by its label, carries the disabled attribute. */
function joinDisabled(html: string): boolean {
  const match = html.match(/<button[^>]*>(?:(?!<\/button>).)*Prijavi se kao volonter/);
  expect(match).not.toBeNull();
  const tag = match![0].slice(0, match![0].indexOf(">") + 1);
  // Class names such as `disabled:opacity-60` are not the attribute.
  return /\sdisabled(?:=""|[\s>])/.test(tag);
}

describe("volunteer signup controls", () => {
  it("asks for the age confirmation and keeps joining disabled until it is given", () => {
    const html = render({});
    expect(html).toContain(
      "Imam najmanje 18 godina ili, ako imam 15 do 17 godina, imam pisanu suglasnost roditelja ili skrbnika."
    );
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*required/);
    expect(joinDisabled(html)).toBe(true);
  });

  it("enables joining once the volunteer confirms", () => {
    expect(joinDisabled(render({ confirmed: true }))).toBe(false);
  });

  it("says who organises and what the organisation sees, linking the privacy policy", () => {
    const html = render({});
    expect(html).toContain("Organizator volontiranja je udruga; ona s vama dogovara sve pojedinosti.");
    expect(html).toContain("Udruga će vidjeti vaše ime i e-adresu.");
    expect(html).toContain('href="/pravila-privatnosti"');
    expect(html).toContain("Pravila privatnosti");
  });

  it("explains a refused signup in Croatian", () => {
    expect(render({ errorKey: "volunteer_signup.age_required" })).toContain(
      "Za prijavu potvrdite svoju dob ili pisanu suglasnost roditelja ili skrbnika."
    );
  });

  it("uses a joining verb distinct from signing in", () => {
    const html = render({ confirmed: true });
    expect(html).toContain("Prijavi se kao volonter");
    expect(html).not.toContain("Prijavite se");
  });
});

describe("volunteerEventReturnPath", () => {
  it("brings a visitor back from sign-in to the same event", () => {
    expect(volunteerEventReturnPath("11111111-1111-4111-8111-111111111111")).toBe(
      "/volunteer?event=11111111-1111-4111-8111-111111111111"
    );
  });
});
