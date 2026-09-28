// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mfa, refreshSession, router } = vi.hoisted(() => ({
  mfa: {
    listFactors: vi.fn(),
    getAuthenticatorAssuranceLevel: vi.fn(),
    enroll: vi.fn(),
    unenroll: vi.fn(),
    challengeAndVerify: vi.fn(),
  },
  refreshSession: vi.fn(),
  router: { refresh: vi.fn(), replace: vi.fn(), push: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: unknown; href: string; className?: string }) =>
    createElement("a", { href, className }, children as never),
}));
vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: true,
  createClient: () => ({ auth: { mfa, refreshSession } }),
}));

import { LocaleProvider } from "@/i18n/client";
import { ToastProvider } from "@/components/ui";
import type { AppRole } from "@/lib/auth/roles";
import { TwoFactorSettings } from "./TwoFactorSettings";

const VERIFIED = { id: "factor-on", factor_type: "totp", status: "verified", friendly_name: "DajSrce" };
const ABANDONED = { id: "factor-abandoned", factor_type: "totp", status: "unverified" };
const QR = "data:image/svg+xml;utf-8,<svg xmlns='http://www.w3.org/2000/svg'></svg>";

function factors(list: Array<{ id: string; status: string; factor_type: string }>) {
  return {
    data: {
      all: list,
      totp: list.filter((factor) => factor.status === "verified"),
      phone: [],
      webauthn: [],
    },
    error: null,
  };
}

function level(currentLevel: "aal1" | "aal2", nextLevel: "aal1" | "aal2") {
  return { data: { currentLevel, nextLevel, currentAuthenticationMethods: [] }, error: null };
}

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

async function render(role: AppRole) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initialLocale: "hr" } as ComponentProps<typeof LocaleProvider>,
        createElement(ToastProvider, null, createElement(TwoFactorSettings, { role }))
      )
    );
  });
  await settle();
}

function button(label: string, scope: ParentNode = document): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === label
  );
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

function hasButton(label: string, scope: ParentNode = document): boolean {
  return [...scope.querySelectorAll("button")].some((b) => (b.textContent ?? "").trim() === label);
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!found) throw new Error("no dialog");
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await settle();
}

function codeInput(scope: ParentNode = document): HTMLInputElement {
  const input = scope.querySelector<HTMLInputElement>('input[name="code"]');
  if (!input) throw new Error("no code input");
  return input;
}

async function typeCode(value: string, scope: ParentNode = document) {
  const input = codeInput(scope);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  for (const fn of Object.values(mfa)) fn.mockReset();
  refreshSession.mockReset();
  refreshSession.mockResolvedValue({ data: {}, error: null });
  router.refresh.mockReset();
  mfa.unenroll.mockResolvedValue({ data: { id: "x" }, error: null });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [{}] as unknown as DOMRectList
  );
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("TwoFactorSettings, turning it on", () => {
  beforeEach(() => {
    mfa.listFactors.mockResolvedValue(factors([ABANDONED]));
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal1", "aal1"));
    mfa.enroll.mockResolvedValue({
      data: { id: "factor-new", type: "totp", totp: { qr_code: QR, secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://" } },
      error: null,
    });
  });

  it("is one section the settings page can link to, and explains itself plainly", async () => {
    await render("individual");
    const section = document.getElementById("dvostupanjska-prijava");
    expect(section?.tagName).toBe("SECTION");
    expect(section?.textContent).toContain("Dvostupanjska prijava");
    expect(text()).toContain("šesteroznamenkasti kod");
    expect(text()).toContain("Google Authenticator ili Microsoft Authenticator");
    expect(text()).toContain("Isključena");
    expect(hasButton("Uključi")).toBe(true);
  });

  it("clears an abandoned attempt, then shows the QR code and the key for manual entry", async () => {
    await render("individual");
    await click(button("Uključi"));

    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "factor-abandoned" });
    expect(mfa.enroll).toHaveBeenCalledWith({ factorType: "totp", friendlyName: "DajSrce" });
    expect(mfa.unenroll.mock.invocationCallOrder[0]).toBeLessThan(
      mfa.enroll.mock.invocationCallOrder[0]
    );
    const qr = document.querySelector<HTMLImageElement>("img");
    expect(qr?.getAttribute("src")).toBe(QR);
    expect(qr?.getAttribute("alt")).toBe(
      "QR kod za povezivanje DajSrca s aplikacijom za autentifikaciju"
    );
    expect(text()).toContain("JBSWY3DPEHPK3PXP");
    const input = codeInput();
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
  });

  it("explains a wrong code, lets it be retried, and turns on with the right one", async () => {
    await render("individual");
    await click(button("Uključi"));
    const form = codeInput().closest("form")!;

    await typeCode("12 34");
    expect(codeInput().value).toBe("1234");
    await submit(form);
    expect(text()).toContain("Upišite šest znamenki iz aplikacije.");
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();

    mfa.challengeAndVerify.mockResolvedValueOnce({
      data: null,
      error: { code: "mfa_verification_failed", message: "Invalid TOTP code entered", status: 422 },
    });
    await typeCode("111 111");
    await submit(form);
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-new", code: "111111" });
    expect(text()).toContain("Kod nije ispravan.");
    expect(codeInput().value).toBe("");

    mfa.challengeAndVerify.mockResolvedValueOnce({ data: { access_token: "t" }, error: null });
    await typeCode("222222");
    await submit(form);
    expect(text()).toContain("Uključena");
    expect(text()).toContain("Dvostupanjska prijava je uključena");
    expect(document.querySelector("img")).toBeNull();
    expect(router.refresh).toHaveBeenCalled();
    expect(hasButton("Isključi")).toBe(true);
  });

  it("removes the half-connected app when the person cancels", async () => {
    await render("individual");
    await click(button("Uključi"));
    mfa.unenroll.mockClear();
    await click(button("Odustani"));
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "factor-new" });
    expect(hasButton("Uključi")).toBe(true);
  });

  it("says why when Supabase refuses to start", async () => {
    mfa.listFactors.mockResolvedValue(factors([]));
    mfa.enroll.mockResolvedValue({
      data: null,
      error: { code: "mfa_totp_enroll_not_enabled", message: "MFA enroll is disabled for TOTP" },
    });
    await render("individual");
    await click(button("Uključi"));
    expect(text()).toContain("Dvostupanjska prijava trenutačno nije dostupna.");
  });
});

describe("TwoFactorSettings, turning it off", () => {
  beforeEach(() => {
    mfa.listFactors.mockResolvedValue(factors([VERIFIED]));
  });

  it("confirms first, then removes the app and refreshes the session", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal2", "aal2"));
    await render("ngo");
    expect(text()).toContain("Uključena");
    await click(button("Isključi"));
    expect(dialog().textContent).toContain("Isključiti dvostupanjsku prijavu?");
    expect(mfa.unenroll).not.toHaveBeenCalled();

    await click(button("Isključi", dialog()));
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "factor-on" });
    expect(refreshSession).toHaveBeenCalled();
    expect(text()).toContain("Dvostupanjska prijava je isključena");
    expect(hasButton("Uključi")).toBe(true);
  });

  it("asks for the current code first when this session did not use the app", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal1", "aal2"));
    mfa.challengeAndVerify.mockResolvedValue({ data: { access_token: "t" }, error: null });
    await render("individual");
    expect(text()).toContain("Ova prijava još nije potvrđena kodom iz aplikacije.");
    await click(button("Isključi"));
    expect(dialog().textContent).toContain("najprije upišite trenutačni kod");

    await typeCode("333333", dialog());
    await click(button("Isključi", dialog()));
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-on", code: "333333" });
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "factor-on" });
    expect(mfa.challengeAndVerify.mock.invocationCallOrder[0]).toBeLessThan(
      mfa.unenroll.mock.invocationCallOrder[0]
    );
  });

  it("switches to asking for the code when Supabase wants an aal2 session", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal2", "aal2"));
    mfa.unenroll.mockResolvedValueOnce({
      data: null,
      error: { code: "insufficient_aal", message: "AAL2 required to unenroll verified factor" },
    });
    await render("individual");
    await click(button("Isključi"));
    await click(button("Isključi", dialog()));
    expect(codeInput(dialog())).toBeTruthy();
    expect(text()).not.toContain("Dvostupanjska prijava je isključena");
  });
});

describe("TwoFactorSettings for an administrator", () => {
  it("says it is mandatory and offers no way to turn it off", async () => {
    mfa.listFactors.mockResolvedValue(factors([VERIFIED]));
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal2", "aal2"));
    await render("superadmin");
    expect(text()).toContain("obavezna, pa se ne može isključiti");
    expect(hasButton("Isključi")).toBe(false);
  });

  it("tells an administrator without it that the administration waits for it", async () => {
    mfa.listFactors.mockResolvedValue(factors([]));
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal1", "aal1"));
    mfa.enroll.mockResolvedValue({
      data: { id: "factor-new", type: "totp", totp: { qr_code: QR, secret: "S", uri: "otpauth://" } },
      error: null,
    });
    mfa.challengeAndVerify.mockResolvedValue({ data: { access_token: "t" }, error: null });
    await render("superadmin");
    expect(text()).toContain("Administracija je dostupna tek kad je uključite.");

    await click(button("Uključi"));
    await typeCode("444444");
    await submit(codeInput().closest("form")!);
    const link = [...document.querySelectorAll("a")].find((a) => a.textContent === "Otvori administraciju");
    expect(link?.getAttribute("href")).toBe("/dashboard/admin");
    expect(hasButton("Isključi")).toBe(false);
  });
});

describe("TwoFactorSettings when Supabase cannot answer", () => {
  it("says so and offers to try again", async () => {
    mfa.listFactors.mockResolvedValueOnce({ data: null, error: { message: "network" } });
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(level("aal1", "aal1"));
    await render("individual");
    expect(text()).toContain("trenutačno se ne mogu učitati");
    expect(hasButton("Uključi")).toBe(false);

    mfa.listFactors.mockResolvedValue(factors([]));
    await click(button("Pokušaj ponovno"));
    expect(hasButton("Uključi")).toBe(true);
  });
});
