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
    title,
  }: {
    children: unknown;
    href: string;
    className?: string;
    onClick?: () => void;
    title?: string;
  }) => createElement("a", { href, className, onClick, title }, children as never),
}));
// Supabase stays "configured" so a test can hand the navbar a session; with
// no user the auth calls simply report none.
const session = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  signOut: null as null | (() => Promise<unknown>),
}));
vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: true,
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: session.user ? { user: session.user } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: () => session.signOut?.() ?? Promise.resolve({ error: null }),
    },
  }),
}));
vi.mock("@/lib/me-client", () => ({
  fetchMe: async () =>
    session.user ? { name: "Ana Horvat", email: session.user.email, role: "individual" } : null,
  invalidateMe: () => {},
}));
vi.mock("@/app/actions/locale", () => ({ setLocaleAction: vi.fn() }));

import { LocaleProvider } from "@/i18n/client";
import { Navbar } from "./Navbar";

let root: Root;

async function mountNavbar() {
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
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ notifications: [] }), { status: 200 }))
  );
  await mountNavbar();
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
  session.user = null;
  session.signOut = null;
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

describe("signed-in navbar", () => {
  beforeEach(async () => {
    await act(() => root.unmount());
    session.user = { id: "u1", email: "ana@example.com" };
    await mountNavbar();
  });

  it("puts sign-out in the desktop pill, right after the profile icon", async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    session.signOut = signOut;
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Odjava"]')];
    // Desktop only: the compact header keeps sign-out inside the menu.
    expect(buttons).toHaveLength(1);
    const [button] = buttons;
    expect(button.title).toBe("Odjava");
    expect(button.previousElementSibling?.getAttribute("href")).toBe("/dashboard");
    await act(async () => {
      button.click();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("shows the account as a profile bubble in the mobile menu", async () => {
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-controls="mobile-nav"]')!;
    await act(async () => {
      trigger.click();
    });
    const menu = document.querySelector("#mobile-nav")!;
    const profile = menu.querySelector<HTMLAnchorElement>('a[href="/dashboard"]')!;
    expect(profile.className).toContain("bg-brand");
    expect(profile.title).toBe("ana@example.com");
    expect(profile.textContent).toBe("Ana HorvatMoj profil");
    const signOut = [...menu.querySelectorAll("button")].find((b) => b.textContent === "Odjava");
    expect(signOut?.querySelector("svg")).not.toBeNull();
  });
});
