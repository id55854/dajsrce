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

  it("says a review needs the authenticator-app code, not another account", async () => {
    respond(403, { error: "Two-step sign-in required", code: "mfa_required" });
    await render([claim({ email_verified: true })]);
    await click(button("Odobri"));
    await click(button("Odobri", dialog()));
    expect(text()).toContain(
      "Za odluke o zahtjevima prijava mora biti potvrđena kodom iz aplikacije za autentifikaciju."
    );
    expect(text()).not.toContain("Nemate ovlasti");
    expect(text()).not.toContain("Two-step sign-in required");
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

type Organisation = NonNullable<InstitutionClaimReviewItem["organisation"]>;

/** A claim as the queue reports it since 20260927110000. */
function classified(id: string, name: string, organisation: Partial<Organisation>) {
  const base = claim();
  return claim({
    id,
    organisation: { ...base.organisation!, name, ...organisation },
  });
}

const UNMAPPED = { category: "association", classification_status: "unmapped" };

async function choose(value: string) {
  const select = dialog().querySelector("select")!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function card(name: string): HTMLElement {
  const heading = [...document.querySelectorAll("h3")].find((h) =>
    (h.textContent ?? "").includes(name)
  );
  if (!heading) throw new Error(`no card "${name}"`);
  return heading.closest("li")!;
}

describe("admin claim queue category", () => {
  it("shows what approval would publish for each kind of row", async () => {
    await render([
      classified("c1", "Udruga Skrb", { category: "elderly_care", classification_status: "auto_eligible" }),
      classified("c2", "Udruga Nesigurna", {
        category: "association",
        classification_status: "needs_review",
        suggested_category: "disability_support",
      }),
      classified("c3", "Tenis klub", UNMAPPED),
    ]);
    expect(card("Udruga Skrb").textContent).toContain("Skrb za starije");
    expect(card("Udruga Nesigurna").textContent).toContain(
      "Klasifikacija nesigurna, prijedlog: Podrška za osobe s invaliditetom"
    );
    expect(card("Tenis klub").textContent).toContain("Nije svrstana među socijalne");
  });

  it("says nothing about the category on a queue that predates it", async () => {
    await render([claim({ email_verified: true })]);
    expect(text()).not.toContain("Kategorija");
    await click(button("Odobri"));
    expect(dialog().querySelector("select")).toBeNull();
  });

  it("will not approve a row that is not social until a category is chosen", async () => {
    respond(200, { claim: { status: "approved" } });
    await render([classified("c3", "Tenis klub", UNMAPPED)]);
    await click(button("Odobri"));
    const select = dialog().querySelector("select")!;
    expect(select.value).toBe("");
    // The twelve social categories and the prompt, never the catch-all.
    expect(select.options).toHaveLength(13);
    expect([...select.options].map((option) => option.value)).not.toContain("association");

    await typeNote("telefonom s predsjednicom udruge 27. 9. 2026.");
    await click(button("Odobri", dialog()));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("Odaberite socijalnu kategoriju ili odbijte zahtjev.");

    await choose("caritas");
    await click(button("Odobri", dialog()));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sentBody()).toEqual({
      decision: "approve",
      note: "Provjereno: telefonom s predsjednicom udruge 27. 9. 2026.",
      category: "caritas",
    });
  });

  it("starts from the register category, or Jev's suggestion for a row left for review", async () => {
    respond(200, { claim: { status: "approved" } });
    await render([
      classified("c1", "Udruga Skrb", { category: "elderly_care", classification_status: "auto_eligible" }),
      classified("c2", "Udruga Nesigurna", {
        category: "association",
        classification_status: "needs_review",
        suggested_category: "disability_support",
      }),
    ]);
    await click(button("Odobri", card("Udruga Nesigurna")));
    expect(dialog().querySelector("select")!.value).toBe("disability_support");
    await click(button("Odustani", dialog()));

    await click(button("Odobri", card("Udruga Skrb")));
    expect(dialog().querySelector("select")!.value).toBe("elderly_care");
    await typeNote("telefonom s predsjednicom udruge 27. 9. 2026.");
    await click(button("Odobri", dialog()));
    expect(sentBody()).toMatchObject({ decision: "approve", category: "elderly_care" });
  });

  it("puts a refusal for want of a category on the select", async () => {
    respond(400, { error: "The decision could not be recorded", code: "category_required" });
    await render([
      classified("c1", "Udruga Skrb", { category: "elderly_care", classification_status: "auto_eligible" }),
    ]);
    await click(button("Odobri"));
    await typeNote("telefonom s predsjednicom udruge 27. 9. 2026.");
    await click(button("Odobri", dialog()));
    expect(dialog().textContent).toContain(
      "Ova udruga nije svrstana među socijalne. Odaberite kategoriju ili odbijte zahtjev."
    );
  });

  it("asks nothing about the category when rejecting", async () => {
    respond(200, { claim: { status: "rejected" } });
    await render([classified("c3", "Tenis klub", UNMAPPED)]);
    await click(button("Odbij"));
    expect(dialog().querySelector("select")).toBeNull();
    await typeNote("DajSrce je samo za udruge socijalnog karaktera.");
    await click(button("Odbij", dialog()));
    expect(sentBody()).toEqual({
      decision: "reject",
      note: "DajSrce je samo za udruge socijalnog karaktera.",
    });
  });
});
