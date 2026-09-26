// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { LocaleProvider } from "@/i18n/client";
import { ToastProvider } from "@/components/ui";
import { InstitutionClaimSetup } from "./InstitutionClaimSetup";

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };

const ENTRY = {
  id: "200307",
  name: "Udruga Srce",
  short_name: null,
  status: "AKTIVAN",
  address: "Ilica 1",
  city: "Zagreb",
  county: "Grad Zagreb",
  registry_number: "21000001",
  legal_form: "Udruga",
  registry_email: "udruga@gmail.com",
  claim_state: "available",
};

const PENDING_CLAIM = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  status: "email_sent",
  udr_id: "200307",
  contact_email: "udruga@gmail.com",
  evidence_note: null,
  email_verified: false,
  email_challenge_sent: true,
  review_note: null,
  reviewed_at: null,
  created_at: "2026-09-28T08:00:00Z",
  organisation: {
    id: "200307",
    name: "Udruga Srce",
    city: "Zagreb",
    county: "Grad Zagreb",
    address: "Ilica 1",
    registry_email: "udruga@gmail.com",
  },
};

let root: Root;
let routes: Handler;
let calls: Array<{ url: string; method: string }>;
let ensureNgoRole: Mock<() => Promise<void>>;

function text() {
  return document.body.textContent ?? "";
}

async function wait(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function render() {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initialLocale: "hr" } as ComponentProps<typeof LocaleProvider>,
        createElement(ToastProvider, null, createElement(InstitutionClaimSetup, { ensureNgoRole }))
      )
    );
  });
  await wait();
}

async function typeSearch(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Past the 300 ms debounce, then let the response render.
  await wait(350);
  await wait();
}

async function click(button: HTMLElement) {
  await act(async () => {
    button.click();
  });
  await wait();
  await wait();
}

function buttonWithText(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label)
  );
  if (!button) throw new Error(`no button "${label}" in: ${text()}`);
  return button;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  calls = [];
  ensureNgoRole = vi.fn(async () => {});
  routes = () => ({ status: 200, body: { claim: null } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const { status, body } = routes(url, init);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("InstitutionClaimSetup search", () => {
  it("asks for 25 rows and says when the list is cut short", async () => {
    routes = (url) =>
      url.startsWith("/api/institution-claims/search")
        ? { status: 200, body: { items: [ENTRY], truncated: true } }
        : { status: 200, body: { claim: null } };
    await render();
    expect(document.querySelector("input[type=search]")?.getAttribute("placeholder")).toBe(
      "Upišite OIB ili naziv udruge"
    );
    await typeSearch("srce");
    const search = calls.find((call) => call.url.startsWith("/api/institution-claims/search"));
    expect(search?.url).toContain("limit=25");
    expect(text()).toContain("Prikazano je prvih 1 rezultata. Suzite pretragu ili upišite OIB udruge.");
  });

  it("shows a failed search as an error, not as an empty result", async () => {
    routes = (url) =>
      url.startsWith("/api/institution-claims/search")
        ? { status: 500, body: { error: "The official register is temporarily unavailable" } }
        : { status: 200, body: { claim: null } };
    await render();
    await typeSearch("srce");
    expect(text()).toContain("Pretraga registra trenutačno nije dostupna");
    expect(text()).not.toContain("Nema aktivne udruge");
    expect(text()).not.toContain("temporarily unavailable");
  });

  it("offers a next step when nothing matches", async () => {
    routes = (url) =>
      url.startsWith("/api/institution-claims/search")
        ? { status: 200, body: { items: [], truncated: false } }
        : { status: 200, body: { claim: null } };
    await render();
    await typeSearch("nepostojeca");
    expect(text()).toContain("Nema aktivne udruge koja odgovara pretrazi.");
    expect(text()).toContain("Pokušajte s OIB-om udruge ili nam pišite na kontakt@dajsrce.hr.");
  });

  it("explains an organisation someone else already holds", async () => {
    routes = (url) =>
      url.startsWith("/api/institution-claims/search")
        ? { status: 200, body: { items: [{ ...ENTRY, claim_state: "linked" }], truncated: false } }
        : { status: 200, body: { claim: null } };
    await render();
    await typeSearch("srce");
    expect(text()).toContain("Već preuzeto");
    expect(text()).toContain("Ovu udrugu već vodi drugi račun na DajSrcu");
    expect(document.querySelector('a[href="mailto:kontakt@dajsrce.hr"]')).not.toBeNull();
  });
});

describe("InstitutionClaimSetup submit", () => {
  async function pick() {
    await typeSearch("srce");
    await click(buttonWithText("Udruga Srce"));
  }

  async function submit() {
    await click(buttonWithText("Pošalji zahtjev na provjeru"));
    await wait();
  }

  async function pickAndSubmit() {
    await pick();
    await submit();
  }

  it("starts the mailbox challenge by itself and names the masked register address", async () => {
    let submitted = false;
    routes = (url, init) => {
      if (url.startsWith("/api/institution-claims/search")) {
        return { status: 200, body: { items: [ENTRY], truncated: false } };
      }
      if (url === "/api/institution-claims" && init?.method === "POST") {
        submitted = true;
        return { status: 201, body: { claim: { id: PENDING_CLAIM.id, organisation: PENDING_CLAIM.organisation } } };
      }
      if (url.endsWith("/verify-email")) {
        return {
          status: 200,
          body: { email_sent: true, claim: { registry_email: "udruga@gmail.com" } },
        };
      }
      return { status: 200, body: { claim: submitted ? PENDING_CLAIM : null } };
    };
    await render();
    await pick();
    expect(text()).toContain(
      "Podatke iz zahtjeva vidi samo administrator DajSrca. Više u Pravilima privatnosti."
    );
    expect(document.querySelector('a[href="/pravila-privatnosti"]')).not.toBeNull();
    await submit();

    expect(ensureNgoRole).toHaveBeenCalledOnce();
    expect(calls.some((call) => call.url.endsWith("/verify-email") && call.method === "POST")).toBe(true);
    expect(text()).toContain("u***@gmail.com");
    // The pending card keeps a manual resend.
    expect(buttonWithText("Pošalji ponovno")).toBeTruthy();
  });

  it("translates a refused claim instead of showing the server's English", async () => {
    routes = (url, init) => {
      if (url.startsWith("/api/institution-claims/search")) {
        return { status: 200, body: { items: [ENTRY], truncated: false } };
      }
      if (url === "/api/institution-claims" && init?.method === "POST") {
        return {
          status: 409,
          body: { error: "The claim could not be submitted", code: "organisation_claimed" },
        };
      }
      return { status: 200, body: { claim: null } };
    };
    await render();
    await pickAndSubmit();
    expect(text()).toContain("Za ovu udrugu već je poslan zahtjev koji čeka pregled.");
    expect(text()).not.toContain("could not be submitted");
    expect(calls.some((call) => call.url.endsWith("/verify-email"))).toBe(false);
  });

  it("keeps the submit disabled while the page withholds it", async () => {
    routes = (url) =>
      url.startsWith("/api/institution-claims/search")
        ? { status: 200, body: { items: [ENTRY], truncated: false } }
        : { status: 200, body: { claim: null } };
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initialLocale: "hr" } as ComponentProps<typeof LocaleProvider>,
          createElement(
            ToastProvider,
            null,
            createElement(InstitutionClaimSetup, {
              ensureNgoRole,
              submitBlocked: true,
              consent: createElement("p", null, "consent-slot"),
            })
          )
        )
      );
    });
    await wait();
    await typeSearch("srce");
    await click(buttonWithText("Udruga Srce"));
    expect(text()).toContain("consent-slot");
    expect(buttonWithText("Pošalji zahtjev na provjeru").disabled).toBe(true);
  });
});
