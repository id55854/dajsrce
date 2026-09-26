// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { replace, router, getUser, updateUser, refreshSession, rpc, profile } = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    replace,
    // Next's router is a stable object; the page's effects depend on that.
    router: { replace },
    getUser: vi.fn(),
    updateUser: vi.fn(),
    refreshSession: vi.fn(),
    rpc: vi.fn(),
    profile: { value: null as null | { role: string; institution_id: string | null } },
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: unknown; href: string; className?: string }) =>
    createElement("a", { href, className }, children as never),
}));
vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: true,
  createClient: () => ({
    auth: { getUser, updateUser, refreshSession },
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: profile.value, error: null }) }),
      }),
    }),
  }),
}));

import { LocaleProvider } from "@/i18n/client";
import { ToastProvider } from "@/components/ui";
import SetupPage from "./page";

const TOKEN = "ab".repeat(32);

let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let hrefAtConfirm: string | null;

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initialLocale: "hr" } as ComponentProps<typeof LocaleProvider>,
        createElement(ToastProvider, null, createElement(SetupPage))
      )
    );
  });
  await settle();
}

function confirmResponds(status: number, body: Record<string, unknown>) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/institution-claims/confirm") {
      hrefAtConfirm = window.location.href;
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ token: TOKEN });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  hrefAtConfirm = null;
  replace.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
  updateUser.mockReset();
  updateUser.mockResolvedValue({ data: { user: {} }, error: null });
  refreshSession.mockReset();
  refreshSession.mockResolvedValue({ data: {}, error: null });
  rpc.mockReset();
  profile.value = null;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("/auth/setup with a claim confirmation link", () => {
  it("confirms the mailbox for a signed-out visitor instead of sending them to sign in", async () => {
    confirmResponds(200, { claim_id: "c1", status: "email_sent", organisation_name: "Udruga Srce" });
    await renderAt(`/auth/setup#claim_token=${TOKEN}`);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalledWith("/auth/login");
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      "E-adresa udruge je potvrđena. Osoba koja je podnijela zahtjev može nastaviti na DajSrcu."
    );
    expect(text).toContain("Udruga Srce");
  });

  it("takes the token out of the address bar before the request is made", async () => {
    confirmResponds(200, { organisation_name: null });
    await renderAt(`/auth/setup?role=ngo&claim_token=${TOKEN}`);
    expect(hrefAtConfirm).not.toBeNull();
    expect(hrefAtConfirm).not.toContain(TOKEN);
    expect(window.location.pathname + window.location.search).toBe("/auth/setup?role=ngo");
    expect(window.location.hash).toBe("");
  });

  it("explains a spent link and what to do next", async () => {
    confirmResponds(409, { error: "The confirmation link is no longer valid", code: "token_used" });
    await renderAt(`/auth/setup#claim_token=${TOKEN}`);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Ova poveznica više ne vrijedi");
    expect(text).toContain("zatražiti novu poveznicu");
    expect(text).toContain("kontakt@dajsrce.hr");
  });

  it("still sends a signed-out visitor without a token to sign in", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await renderAt("/auth/setup");
    expect(replace).toHaveBeenCalledWith("/auth/login");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/auth/setup for a signed-in account", () => {
  function buttonWithText(label: string): HTMLButtonElement {
    const button = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(label)
    );
    if (!button) throw new Error(`no button "${label}"`);
    return button;
  }

  async function click(element: HTMLElement) {
    await act(async () => {
      element.click();
    });
    await settle();
  }

  function signedIn(metadata: Record<string, unknown>, provider = "google") {
    getUser.mockResolvedValue({
      data: { user: { id: "u1", app_metadata: { provider }, user_metadata: metadata } },
    });
  }

  beforeEach(() => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ claim: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("asks a Google sign-in for the terms before its role is saved", async () => {
    signedIn({});
    profile.value = { role: "individual", institution_id: null };
    rpc.mockResolvedValue({ data: [{ profile_role: "individual" }], error: null });
    await renderAt("/auth/setup");

    expect(document.body.textContent).toContain("Imam najmanje 16 godina");
    await click(buttonWithText("Želim pomoći"));
    expect(buttonWithText("Nastavi").disabled).toBe(true);

    await click(document.querySelector<HTMLInputElement>('input[name="terms"]')!);
    expect(buttonWithText("Nastavi").disabled).toBe(false);
    await click(buttonWithText("Nastavi"));

    expect(rpc).toHaveBeenCalledWith("complete_profile_setup", {
      p_role: "individual",
      p_institution_name: null,
    });
    const data = updateUser.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data).toMatchObject({ role: "individual", setup_completed: true });
    expect(typeof data.terms_version).toBe("string");
    expect(typeof data.terms_accepted_at).toBe("string");
    expect(refreshSession).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/dashboard/individual");
  });

  it("does not ask again once the account has accepted the current terms", async () => {
    signedIn({ terms_version: "2026-09-27", terms_accepted_at: "2026-09-27T10:00:00Z" }, "email");
    profile.value = { role: "individual", institution_id: null };
    await renderAt("/auth/setup");
    expect(document.querySelector('input[name="terms"]')).toBeNull();
  });

  it("switches an unlinked NGO account back to an individual", async () => {
    signedIn({ role: "ngo", terms_version: "2026-09-27", terms_accepted_at: "2026-09-27T10:00:00Z" }, "email");
    profile.value = { role: "ngo", institution_id: null };
    rpc.mockResolvedValue({ data: [{ profile_role: "individual", profile_institution_id: null }], error: null });
    await renderAt("/auth/setup");

    await click(buttonWithText("Želim pomoći"));
    await click(buttonWithText("Nastavi"));
    expect(replace).toHaveBeenCalledWith("/dashboard/individual");
  });

  it("explains why an NGO account with a request under review stays an NGO", async () => {
    signedIn({ role: "ngo", terms_version: "2026-09-27", terms_accepted_at: "2026-09-27T10:00:00Z" }, "email");
    profile.value = { role: "ngo", institution_id: null };
    rpc.mockResolvedValue({ data: [{ profile_role: "ngo", profile_institution_id: null }], error: null });
    await renderAt("/auth/setup");

    await click(buttonWithText("Želim pomoći"));
    await click(buttonWithText("Nastavi"));
    expect(replace).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Najprije povucite zahtjev");
  });

  it("opens the claim for an existing account that followed a claim-this-profile link", async () => {
    signedIn({ setup_completed: true, terms_version: "2026-09-27", terms_accepted_at: "2026-09-27T10:00:00Z" });
    profile.value = { role: "individual", institution_id: null };
    await renderAt("/auth/setup?role=ngo");
    expect(replace).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Pronađite svoju udrugu");
  });
});
