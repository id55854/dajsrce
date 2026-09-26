// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { replace, getUser, signUp, search } = vi.hoisted(() => ({
  replace: vi.fn(),
  getUser: vi.fn(),
  signUp: vi.fn(),
  search: { value: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: unknown; href: string; className?: string }) =>
    createElement("a", { href, className }, children as never),
}));
vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: true,
  createClient: () => ({ auth: { getUser, signUp } }),
}));

import { LocaleProvider } from "@/i18n/client";
import { TERMS_VERSION } from "@/lib/auth/terms";
import RegisterPage from "./page";

let root: Root;

function text() {
  return document.body.textContent ?? "";
}

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(query: string) {
  search.value = query;
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initialLocale: "hr" } as ComponentProps<typeof LocaleProvider>,
        createElement(RegisterPage)
      )
    );
  });
  await settle();
}

async function type(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function acceptTerms() {
  await act(async () => {
    document.querySelector<HTMLInputElement>('input[name="terms"]')!.click();
  });
}

function submitButton() {
  return document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
}

async function submit() {
  await act(async () => {
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  replace.mockReset();
  signUp.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
});

afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("/auth/register", () => {
  it("opens the NGO form directly from an invitation link", async () => {
    for (const query of ["role=ngo", "uloga=udruga"]) {
      // A fresh root per link: the preset is initial state, not a prop.
      await act(() => root.unmount());
      root = createRoot(document.querySelector("#root")!);
      await render(query);
      expect(text(), query).toContain("Predstavljam udrugu");
      expect(text(), query).toContain("Vaša e-pošta za prijavu");
      expect(document.querySelector("form")?.getAttribute("method")).toBe("post");
    }
  });

  it("starts at the role question without a preset", async () => {
    await render("");
    expect(text()).toContain("Tko ste?");
    expect(document.querySelector("form")).toBeNull();
  });

  it("keeps the submit disabled until the age and terms statement is accepted", async () => {
    await render("role=ngo");
    expect(text()).toContain("Imam najmanje 16 godina i prihvaćam Uvjete korištenja.");
    expect(document.querySelector('a[href="/uvjeti-koristenja"]')).not.toBeNull();
    expect(document.querySelector('a[href="/pravila-privatnosti"]')).not.toBeNull();
    expect(submitButton().disabled).toBe(true);
    await acceptTerms();
    expect(submitButton().disabled).toBe(false);
  });

  it("says so when the password is refused instead of returning silently", async () => {
    await render("role=ngo");
    await type('input[name="name"]', "Ana Anić");
    await type('input[name="email"]', "ana@example.hr");
    await type('input[name="password"]', "dajsrcedajsrce1");
    await acceptTerms();
    await submit();
    expect(signUp).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Lozinka je preslaba");
  });

  it("records which terms were accepted, and when, with the sign-up", async () => {
    signUp.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    await render("role=ngo");
    await type('input[name="name"]', "Ana Anić");
    await type('input[name="email"]', "ana@example.hr");
    await type('input[name="password"]', "Kiselo-Jabuka-47-Zvono");
    await acceptTerms();
    await submit();
    expect(signUp).toHaveBeenCalledOnce();
    const data = signUp.mock.calls[0]?.[0]?.options?.data as Record<string, unknown>;
    expect(data).toMatchObject({ name: "Ana Anić", role: "ngo", terms_version: TERMS_VERSION });
    expect(typeof data.terms_accepted_at).toBe("string");
    expect(Number.isNaN(Date.parse(String(data.terms_accepted_at)))).toBe(false);
  });

  it("sends a signed-in visitor on to the claim instead of a second sign-up", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    await render("role=ngo");
    expect(replace).toHaveBeenCalledWith("/auth/setup?role=ngo");
  });
});
