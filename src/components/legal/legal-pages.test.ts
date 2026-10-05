import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Locale } from "@/lib/types";

const request = vi.hoisted(() => ({ locale: "hr" as Locale }));

vi.mock("@/i18n/server", () => ({ getLocale: async () => request.locale }));
vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) =>
    createElement("a", { href, className }, children),
}));

import CookiesPage, { metadata as cookiesMetadata } from "@/app/kolacici/page";
import PrivacyPolicyPage, { metadata as privacyMetadata } from "@/app/pravila-privatnosti/page";
import TermsOfUsePage, { metadata as termsMetadata } from "@/app/uvjeti-koristenja/page";

const PAGES = [
  {
    path: "/pravila-privatnosti",
    title: "Pravila privatnosti | DajSrce",
    Page: PrivacyPolicyPage,
    metadata: privacyMetadata,
  },
  {
    path: "/uvjeti-koristenja",
    title: "Uvjeti korištenja | DajSrce",
    Page: TermsOfUsePage,
    metadata: termsMetadata,
  },
  { path: "/kolacici", title: "Kolačići | DajSrce", Page: CookiesPage, metadata: cookiesMetadata },
];

async function render(Page: () => Promise<ReactElement>, locale: Locale): Promise<string> {
  request.locale = locale;
  return renderToStaticMarkup(await Page());
}

/** Visible text, with tags as word breaks. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function article(html: string): string {
  return html.match(/<article lang="hr">[\s\S]*<\/article>/)?.[0] ?? "";
}

describe.each(PAGES)("$path", ({ path, title, Page, metadata }) => {
  it("has its own title, description and canonical URL", () => {
    expect(metadata.title).toBe(title);
    expect(metadata.description).toBeTruthy();
    expect(metadata.alternates?.canonical).toBe(`https://dajsrce.hr${path}`);
  });

  it("opens with one heading, the version, the dates and a summary", async () => {
    const html = await render(Page, "hr");
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    const body = text(html);
    expect(body).toContain("Verzija 1.2");
    expect(body).toContain("5. listopada 2026.");
    expect(body).toContain("Posljednja izmjena: 5. listopada 2026.");
    expect(body).toContain("Ukratko");
  });

  it("publishes no drafting placeholder or operator note", async () => {
    const body = text(await render(Page, "hr"));
    expect(body).not.toMatch(/[[\]]/);
    expect(body).not.toMatch(/operater|opcij[ae] [ab]|datum objave|provjeriti|web analytics/i);
  });

  it("points every in-page link at a heading that exists", async () => {
    const html = await render(Page, "hr");
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) expect(ids).toContain(anchor);
  });

  it("shows English readers the same Croatian document under one English line", async () => {
    const hr = await render(Page, "hr");
    const en = await render(Page, "en");

    expect(hr).not.toContain('lang="en"');
    expect(text(en)).toContain(
      "This document is available in Croatian only. It is the binding version."
    );
    expect(article(en)).not.toBe("");
    expect(article(en)).toBe(article(hr));
  });
});

describe("privacy policy", () => {
  it("links every section and subsection from its table of contents", async () => {
    const html = await render(PrivacyPolicyPage, "hr");
    expect([...html.matchAll(/href="#/g)]).toHaveLength(24);
  });

  it("says which other registers it reads and what it never takes from them", async () => {
    const body = text(await render(PrivacyPolicyPage, "hr"));
    expect(body).toContain("Evidencija pravnih osoba Katoličke Crkve u Republici Hrvatskoj");
    expect(body).toContain("Registar pružatelja socijalnih usluga");
    expect(body).toMatch(/Ne preuzimamo\s*osobe ovlaštene za zastupanje ni osobe za kontakt,\s*bankovne račune/);
    expect(body).toContain("na karti javno prikazujemo samo Caritas");
    expect(body).toContain("Podaci ostalih organizacija ne prikazuju se javno na karti");
  });

  it("names the supervisory authority at the address AZOP publishes", async () => {
    const body = text(await render(PrivacyPolicyPage, "hr"));
    expect(body).toContain(
      "Agenciji za zaštitu osobnih podataka (AZOP), Ulica Metela Ožegovića 16, 10000 Zagreb"
    );
  });

  it("says the association sees the pledge message and nothing about activity totals", async () => {
    const body = text(await render(PrivacyPolicyPage, "hr"));
    expect(body).toContain("Udruga vidi i poruku koju ste napisali uz obećanje.");
    expect(body).not.toMatch(/ukupan broj/i);
  });
});
