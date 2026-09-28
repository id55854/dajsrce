// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { router, search, getUser, signInWithPassword, getAuthenticatorAssuranceLevel } = vi.hoisted(
  () => ({
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    search: { value: "" },
    getUser: vi.fn(),
    signInWithPassword: vi.fn(),
    getAuthenticatorAssuranceLevel: vi.fn(),
  })
);

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: unknown; href: string; className?: string }) =>
    createElement("a", { href, className }, children as never),
}));
vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: true,
  createClient: () => ({
    auth: { getUser, signInWithPassword, mfa: { getAuthenticatorAssuranceLevel } },
  }),
}));

import { LocaleProvider } from "@/i18n/client";
import LoginPage from "./page";

let root: Root;

async function settle() {
  for (let i = 0; i < 4; i += 1) {
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
        createElement(LoginPage)
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

async function signIn() {
  await type('input[name="email"]', "ana@example.hr");
  await type('input[name="password"]', "dugacka-lozinka");
  await act(async () => {
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

function level(currentLevel: string, nextLevel: string) {
  return { data: { currentLevel, nextLevel, currentAuthenticationMethods: [] }, error: null };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  router.push.mockReset();
  router.replace.mockReset();
  router.refresh.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
  signInWithPassword.mockReset();
  signInWithPassword.mockResolvedValue({ data: {}, error: null });
  getAuthenticatorAssuranceLevel.mockReset();
});

afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("/auth/login and two-step sign-in", () => {
  it("sends an account with an authenticator app to the code after the password", async () => {
    getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal1", "aal2"));
    await render("next=%2Fdoniraj");
    await signIn();
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "ana@example.hr",
      password: "dugacka-lozinka",
    });
    expect(router.push).toHaveBeenCalledWith("/auth/mfa?next=%2Fdoniraj");
  });

  it("goes straight to next for an account without one", async () => {
    getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal1", "aal1"));
    await render("next=%2Fdoniraj");
    await signIn();
    expect(router.push).toHaveBeenCalledWith("/doniraj");
  });

  it("does not ask for the code after a refused password", async () => {
    signInWithPassword.mockResolvedValue({
      data: {},
      error: { code: "invalid_credentials", message: "Invalid login credentials" },
    });
    await render("");
    await signIn();
    expect(router.push).not.toHaveBeenCalled();
    expect(getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("E-pošta ili lozinka nisu ispravni.");
  });

  it("sends a signed-in session that has not given the code back to the code page", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal1", "aal2"));
    await render("next=%2Fdashboard%2Fngo");
    expect(router.replace).toHaveBeenCalledWith("/auth/mfa?next=%2Fdashboard%2Fngo");
  });
});
