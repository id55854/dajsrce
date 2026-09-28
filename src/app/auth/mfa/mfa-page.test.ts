// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { router, search, mfa, refreshSession, signOut } = vi.hoisted(() => ({
  // Next's router is a stable object; the page's effect depends on that.
  router: { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() },
  search: { value: "" },
  mfa: {
    getAuthenticatorAssuranceLevel: vi.fn(),
    listFactors: vi.fn(),
    challengeAndVerify: vi.fn(),
  },
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: true,
  createClient: () => ({ auth: { mfa, refreshSession, signOut } }),
}));

import { LocaleProvider } from "@/i18n/client";
import MfaPage from "./page";

const VERIFIED = { id: "factor-1", factor_type: "totp", status: "verified" };

let root: Root;

function text() {
  return document.body.textContent ?? "";
}

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
        createElement(MfaPage)
      )
    );
  });
  await settle();
}

function level(currentLevel: string | null, nextLevel: string | null) {
  return { data: { currentLevel, nextLevel, currentAuthenticationMethods: [] }, error: null };
}

function factors(list: typeof VERIFIED[]) {
  return { data: { all: list, totp: list, phone: [], webauthn: [] }, error: null };
}

async function typeCode(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[name="code"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
  router.replace.mockReset();
  router.refresh.mockReset();
  for (const fn of Object.values(mfa)) fn.mockReset();
  refreshSession.mockReset();
  refreshSession.mockResolvedValue({ data: {}, error: null });
  signOut.mockReset();
  signOut.mockResolvedValue({ error: null });
  mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal1", "aal2"));
  mfa.listFactors.mockResolvedValue(factors([VERIFIED]));
});

afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("/auth/mfa", () => {
  it("asks an aal1 session with an authenticator app for the six-digit code", async () => {
    await render("next=%2Fdashboard%2Fngo");
    expect(text()).toContain("Upišite kod iz aplikacije");
    expect(text()).toContain("šesteroznamenkasti kod za DajSrce");
    const input = document.querySelector<HTMLInputElement>('input[name="code"]')!;
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(document.querySelector("form")?.getAttribute("method")).toBe("post");
    expect(text()).toContain("kontakt@dajsrce.hr");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("explains a wrong code and continues to where the sign-in was going", async () => {
    await render("next=%2Fdashboard%2Fngo");
    mfa.challengeAndVerify.mockResolvedValueOnce({
      data: null,
      error: { code: "mfa_verification_failed", message: "Invalid TOTP code entered", status: 422 },
    });
    await typeCode("000000");
    await submit();
    expect(text()).toContain("Kod nije ispravan.");
    expect(router.replace).not.toHaveBeenCalled();

    mfa.challengeAndVerify.mockResolvedValueOnce({ data: { access_token: "t" }, error: null });
    await typeCode("123 456");
    await submit();
    expect(mfa.challengeAndVerify).toHaveBeenLastCalledWith({ factorId: "factor-1", code: "123456" });
    expect(router.replace).toHaveBeenCalledWith("/dashboard/ngo");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("asks for all six digits before sending anything", async () => {
    await render("next=%2Fdashboard");
    await typeCode("12");
    await submit();
    expect(text()).toContain("Upišite šest znamenki iz aplikacije.");
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("goes straight on when the session already used the app", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal2", "aal2"));
    await render("next=%2Fdashboard%2Fadmin");
    expect(router.replace).toHaveBeenCalledWith("/dashboard/admin");
    expect(mfa.listFactors).not.toHaveBeenCalled();
  });

  it("sends a visitor without a session to sign in, keeping the destination", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level(null, null));
    await render("next=%2Fdashboard%2Fngo");
    expect(router.replace).toHaveBeenCalledWith("/auth/login?next=%2Fdashboard%2Fngo");
  });

  it("refreshes a session that still lists a removed app, then continues", async () => {
    mfa.listFactors.mockResolvedValue(factors([]));
    await render("next=%2Fdashboard%2Findividual");
    expect(refreshSession).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/dashboard/individual");
  });

  it("never continues off the site", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal2", "aal2"));
    await render("next=https%3A%2F%2Fevil.test");
    expect(router.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("offers signing out of this browser as the way out", async () => {
    await render("next=%2Fdashboard");
    const signOutButton = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Odjavi se"
    )!;
    await act(async () => {
      signOutButton.click();
    });
    await settle();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(router.replace).toHaveBeenCalledWith("/auth/login");
  });
});
