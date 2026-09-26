// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { router } = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { LocaleProvider } from "@/i18n/client";
import { ToastProvider } from "@/components/ui";
import type { InstitutionClaimReviewItem } from "@/lib/institution-claims";
import { InstitutionClaimQueue } from "./institution-claim-queue";

const NOW = Date.parse("2026-09-28T10:00:00Z");

function claim(overrides: Partial<InstitutionClaimReviewItem> = {}): InstitutionClaimReviewItem {
  return {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    status: "pending",
    udr_id: "200307",
    contact_email: "predsjednica@gmail.com",
    evidence_note: "Predsjednica udruge, tel. 091 000 0000",
    email_verified: false,
    email_challenge_sent: false,
    email_challenge_expires_at: null,
    created_at: "2026-09-28T08:00:00Z",
    reviewed_at: null,
    review_note: null,
    applicant: { id: "p1", name: "Ana Anić", email: "ana@example.hr", role: "ngo" },
    organisation: {
      id: "200307",
      name: "Udruga Srce",
      short_name: null,
      status: "AKTIVAN",
      oib: "12345678901",
      city: "Zagreb",
      county: "Grad Zagreb",
      address: "Ilica 1, Zagreb",
      registry_email: "ured@udrugasrce.hr",
      registry_number: "21000001",
      legal_form: "Udruga",
      website: "www.udrugasrce.hr",
      already_linked: false,
    },
    ...overrides,
  };
}

let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

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

async function render(claims: InstitutionClaimReviewItem[], total = claims.length) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initialLocale: "hr" } as ComponentProps<typeof LocaleProvider>,
        createElement(
          ToastProvider,
          null,
          createElement(InstitutionClaimQueue, { claims, total, renderedAt: NOW })
        )
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

async function typeNote(value: string) {
  const textarea = dialog().querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  );
}

function sentBody(): { decision: string; note: string | null } {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  router.refresh.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [{}] as unknown as DOMRectList
  );
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("admin claim queue", () => {
  it("shows the evidence a reviewer needs, and flags what is not evidence", async () => {
    await render([claim()], 137);
    const content = text();
    for (const expected of [
      "Udruga Srce",
      "200307",
      "12345678901",
      "21000001",
      "ured@udrugasrce.hr",
      "predsjednica@gmail.com",
      "Razlikuje se od registra",
      "Poveznica nije poslana",
      "www.udrugasrce.hr",
      "Ana Anić",
      "ana@example.hr (nepotvrđena e-adresa računa)",
      "Predsjednica udruge, tel. 091 000 0000",
      "Prikazano je najstarijih 1 od 137 zahtjeva na čekanju.",
    ]) {
      expect(content, expected).toContain(expected);
    }
    expect(document.querySelector('a[href="https://www.udrugasrce.hr/"]')).not.toBeNull();
  });

  it("marks a confirmed register mailbox and an expired link", async () => {
    await render([
      claim({ email_verified: true, contact_email: "ured@udrugasrce.hr" }),
      claim({
        id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        email_challenge_sent: true,
        email_challenge_expires_at: "2026-09-27T10:00:00Z",
      }),
    ]);
    expect(text()).toContain("E-adresa iz registra potvrđena");
    expect(text()).toContain("Poveznica je istekla");
    // Matching addresses are not flagged.
    expect(text().match(/Razlikuje se od registra/g)).toHaveLength(1);
  });

  it("requires the out-of-band check before approving an unconfirmed claim", async () => {
    respond(200, { claim: { status: "approved" } });
    await render([claim()]);
    await click(button("Odobri"));

    expect(dialog().textContent).toContain("Kako ste provjerili da podnositelj predstavlja udrugu?");
    await click(button("Odobri", dialog()));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("Opišite kako ste provjerili podnositelja.");

    await typeNote("telefonom s predsjednicom udruge 27. 9. 2026.");
    await click(button("Odobri", dialog()));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "/api/institution-claims/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/review"
    );
    expect(sentBody()).toEqual({
      decision: "approve",
      note: "Provjereno: telefonom s predsjednicom udruge 27. 9. 2026.",
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("keeps the note optional when the register mailbox was confirmed", async () => {
    respond(200, { claim: { status: "approved" } });
    await render([claim({ email_verified: true })]);
    await click(button("Odobri"));
    expect(dialog().textContent).toContain("Bilješka uz odluku");
    await click(button("Odobri", dialog()));
    expect(sentBody()).toEqual({ decision: "approve", note: null });
  });

  it("asks for the check when the transaction refuses an unconfirmed mailbox", async () => {
    respond(409, { error: "The decision could not be recorded", code: "mailbox_not_verified" });
    await render([claim({ email_verified: true })]);
    await click(button("Odobri"));
    await click(button("Odobri", dialog()));
    expect(dialog().textContent).toContain("Kako ste provjerili da podnositelj predstavlja udrugu?");
    expect(text()).toContain("E-adresa iz registra nije potvrđena.");
    expect(text()).not.toContain("could not be recorded");
  });

  it("shows a refused review in Croatian", async () => {
    respond(409, { error: "The decision could not be recorded", code: "claim_closed" });
    await render([claim()]);
    await click(button("Odbij"));
    await typeNote("Nije dokazano.");
    await click(button("Odbij", dialog()));
    expect(sentBody()).toEqual({ decision: "reject", note: "Nije dokazano." });
    expect(text()).toContain("Zahtjev je u međuvremenu već riješen ili povučen.");
  });
});
