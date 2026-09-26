import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never),
}));

import { LocaleProvider } from "@/i18n/client";
import { ToastProvider } from "@/components/ui";
import { VolunteerEventCard } from "./VolunteerEventCard";
import { NeedCard, type NeedCardNeed } from "./NeedCard";

const event = {
  id: "11111111-1111-4111-8111-111111111111",
  institution_id: "22222222-2222-4222-8222-222222222222",
  title: "Podjela obroka",
  description: "",
  event_date: "2026-10-01",
  start_time: "09:00",
  end_time: "12:00",
  volunteers_needed: 4,
  volunteers_signed_up: 4,
  requirements: null,
  contact_person: null,
  contact_phone: null,
  is_past: false,
  created_at: "2026-09-01T00:00:00Z",
};

const need: NeedCardNeed = {
  id: "33333333-3333-4333-8333-333333333333",
  institution_id: event.institution_id,
  title: "Zimske jakne",
  description: "",
  donation_type: "clothes",
  urgency: "routine",
  quantity_needed: 10,
  quantity_pledged: 10,
  quantity_delivered: 0,
  photo_url: null,
  deadline: null,
  is_fulfilled: false,
  created_at: "2026-09-01T00:00:00Z",
};

function render(node: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(createElement(
      LocaleProvider,
      { initialLocale: "hr" } as ComponentProps<typeof LocaleProvider>,
      createElement(ToastProvider, null, node)
    ));
}

describe("capacity on the public cards", () => {
  it("greys out a full event and offers no signup", () => {
    const html = render(createElement(VolunteerEventCard, { event }));
    expect(html).toContain("grayscale");
    expect(html).toContain(">Popunjeno<");
    expect(html).not.toContain(">Pridruži se<");
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("keeps the confirmation for someone already registered on a full event", () => {
    const html = render(createElement(VolunteerEventCard, { event, isRegistered: true }));
    expect(html).not.toContain("grayscale");
    expect(html).toContain("Prijavljeni ste");
  });

  it("leaves an event with places open", () => {
    const html = render(createElement(VolunteerEventCard, { event: { ...event, volunteers_signed_up: 3 } }));
    expect(html).not.toContain("grayscale");
    // Joining is its own verb, so it never reads like signing in.
    expect(html).toContain(">Pridruži se<");
    expect(html).not.toContain("Prijavite se");
  });

  it("greys out a fully pledged need and disables giving", () => {
    const html = render(createElement(NeedCard, { need }));
    expect(html).toContain("grayscale");
    expect(html).toContain("Prikupljeno");
    expect(html).not.toContain("Mogu pomoći");
  });

  it("treats an explicitly fulfilled need without a target as full", () => {
    const html = render(createElement(NeedCard, { need: { ...need, quantity_needed: null, quantity_pledged: 2, is_fulfilled: true } }));
    expect(html).toContain("Prikupljeno");
  });

  it("leaves a need that still has room open", () => {
    const html = render(createElement(NeedCard, { need: { ...need, quantity_pledged: 6 } }));
    expect(html).not.toContain("grayscale");
    expect(html).toContain("Mogu pomoći");
  });

  it("offers a quiet way to report a need, naming it in the prefilled e-mail", () => {
    const html = render(createElement(NeedCard, { need }));
    expect(html).toContain(">Prijavi sadržaj<");
    expect(html).toContain("mailto:kontakt@dajsrce.hr?subject=Prijava%20sadr%C5%BEaja");
    expect(html).toContain(encodeURIComponent(`ID potrebe: ${need.id}`));
    expect(html).toContain(`id="need-${need.id}"`);
  });

  it("offers withdraw on a registered event only when it knows the signup", () => {
    const registered = { event: { ...event, volunteers_signed_up: 2 }, isRegistered: true };
    expect(render(createElement(VolunteerEventCard, registered))).not.toContain("Otkaži prijavu");
    const html = render(createElement(VolunteerEventCard, { ...registered, signupId: "s1", onCancelled: () => {} }));
    expect(html).toContain("Prijavljeni ste");
    expect(html).toContain("Otkaži prijavu");
  });

  it("offers withdraw on a need only to someone who pledged to it", () => {
    const open = { ...need, quantity_pledged: 4 };
    expect(render(createElement(NeedCard, { need: open, onPledgesCancelled: () => {} }))).not.toContain("Otkaži obećanje");
    const html = render(createElement(NeedCard, {
      need: open,
      myPledgedQty: 2,
      myPledgeIds: ["p1", "p2"],
      onPledgesCancelled: () => {},
    }));
    expect(html).toContain("Otkaži obećanje");
  });
});
