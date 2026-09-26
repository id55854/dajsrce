// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
    onClick,
  }: {
    children: unknown;
    href: string;
    className?: string;
    onClick?: () => void;
  }) => createElement("a", { href, className, onClick }, children as never),
}));
vi.mock("@/lib/supabase/client", () => ({ isSupabaseConfigured: false, createClient: vi.fn() }));
vi.mock("@/app/actions/locale", () => ({ setLocaleAction: vi.fn() }));

import { LocaleProvider } from "@/i18n/client";
import { Navbar } from "./Navbar";

let root: Root;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  );
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initialLocale: "hr" } as ComponentProps<typeof LocaleProvider>,
        createElement(Navbar)
      )
    );
  });
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function links(href: string) {
  return [...document.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`)];
}

describe("signed-out navbar", () => {
  it("offers association sign-up next to sign-in", () => {
    const [register] = links("/auth/register?role=ngo");
    expect(register?.textContent).toContain("Registrirajte udrugu");
    expect(links("/auth/login")).toHaveLength(1);
  });

  it("lists sign-up and the legal pages in the mobile menu", async () => {
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-controls="mobile-nav"]')!;
    await act(async () => {
      trigger.click();
    });
    const menu = document.querySelector("#mobile-nav")!;
    expect(menu.querySelector('a[href="/auth/register?role=ngo"]')?.textContent).toBe(
      "Registrirajte udrugu"
    );
    expect(menu.querySelector('a[href="/pravila-privatnosti"]')?.textContent).toBe(
      "Pravila privatnosti"
    );
    expect(menu.querySelector('a[href="/uvjeti-koristenja"]')?.textContent).toBe(
      "Uvjeti korištenja"
    );
    expect(menu.querySelector('a[href="/o-nama"]')).not.toBeNull();
  });
});
