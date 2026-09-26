import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { PageHeader, PageShell } from "@/components/ui";
import { ORGANISATION } from "@/lib/organisation";
import type { Locale } from "@/lib/types";

/**
 * The frame shared by the three legal documents: `/pravila-privatnosti`,
 * `/uvjeti-koristenja` and `/kolacici`.
 *
 * The documents are Croatian only. Their text is written straight into the
 * page components rather than into the i18n dictionaries, because the
 * dictionaries ship to every visitor on every page and these run to thousands
 * of words. An English visitor sees the same Croatian text under a one-line
 * notice that it is the binding version, and the document is marked
 * `lang="hr"` so assistive technology pronounces it as Croatian either way.
 *
 * Server components only: nothing here needs the browser.
 */

export const LEGAL_VERSION = "1.0";

/** Version 1.0 took effect on the day it was last changed. */
export const LEGAL_DATE = { iso: "2026-09-27", label: "27. rujna 2026." } as const;

/** The one mailbox every legal document names for requests and notices. */
export const LEGAL_CONTACT_EMAIL = "kontakt@dajsrce.hr";

// Absolute on purpose, so the canonical names the production site whether or
// not a `metadataBase` is in force, and a preview deployment never presents
// itself as the binding copy of a legal document.
const CANONICAL_ORIGIN = "https://dajsrce.hr";

export function legalMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: `/${string}`;
}): Metadata {
  return {
    title: `${title} | ${ORGANISATION.shortName}`,
    description,
    alternates: { canonical: `${CANONICAL_ORIGIN}${path}` },
  };
}

/**
 * One heading of a document. The table of contents and the heading itself are
 * rendered from the same entry, so an anchor can never point at a title that
 * has since been renamed.
 */
export type LegalTocEntry = {
  id: string;
  title: string;
  children?: readonly LegalTocEntry[];
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

// `brand-on-soft` rather than `brand`: the brand red is below 4.5:1 on white,
// and these links sit inside running text. The underline keeps them
// distinguishable without relying on colour.
const LINK_CLASSES = clsx(
  "rounded-sm font-medium text-brand-on-soft underline decoration-1 underline-offset-2 hover:decoration-2",
  FOCUS_RING
);

// Only direct children get the reading measure, so a table (wrapped in a div)
// keeps the full column while running text stays at a comfortable length.
const BODY_CLASSES = clsx(
  "space-y-4 text-base leading-7 text-ink-secondary",
  "[&>address]:max-w-prose [&>ol]:max-w-prose [&>p]:max-w-prose [&>ul]:max-w-prose",
  "[&>ol]:space-y-2 [&>ul]:list-disc [&>ul]:space-y-2 [&>ul]:pl-5",
  "[&_strong]:font-semibold [&_strong]:text-ink"
);

export function LegalDocument({
  locale,
  title,
  subtitle,
  effectiveFrom,
  summary,
  toc,
  children,
}: {
  locale: Locale;
  title: string;
  subtitle?: string;
  /** The document's own wording before its effective date, e.g. "primjenjuje se od". */
  effectiveFrom: string;
  /** Body of the "Ukratko" box at the top. */
  summary: ReactNode;
  toc?: readonly LegalTocEntry[];
  children: ReactNode;
}) {
  return (
    <PageShell width="content">
      {locale === "en" ? (
        <p
          lang="en"
          className="mb-6 max-w-prose rounded-control border border-border-subtle bg-surface-sunken px-4 py-3 text-sm leading-6 text-ink"
        >
          This document is available in Croatian only. It is the binding version.
        </p>
      ) : null}

      <article lang="hr">
        <PageHeader
          title={title}
          subtitle={
            <>
              {subtitle ? <span className="mb-2 block">{subtitle}</span> : null}
              <span className="block text-sm leading-6">
                Verzija {LEGAL_VERSION} · {effectiveFrom}{" "}
                <time dateTime={LEGAL_DATE.iso}>{LEGAL_DATE.label}</time>
              </span>
              <span className="block text-sm leading-6">
                Posljednja izmjena:{" "}
                <time dateTime={LEGAL_DATE.iso}>{LEGAL_DATE.label}</time>
              </span>
            </>
          }
        />

        <div className="max-w-prose space-y-6">
          <section className="rounded-card border border-border-subtle bg-surface-sunken p-5">
            <h2 id="ukratko" className="scroll-mt-24 text-lg font-semibold text-ink">
              Ukratko
            </h2>
            <div className={clsx("mt-3", BODY_CLASSES)}>{summary}</div>
          </section>

          {toc ? <TableOfContents entries={toc} /> : null}
        </div>

        {/* Headings carry the structure. The sections are deliberately not
            labelled regions: a dozen landmarks per page would bury the ones
            that matter in a screen reader's landmark list. */}
        <div className="mt-10 space-y-10 sm:mt-12">{children}</div>
      </article>
    </PageShell>
  );
}

function TableOfContents({ entries }: { entries: readonly LegalTocEntry[] }) {
  return (
    <nav aria-labelledby="sadrzaj" className="rounded-card border border-border-subtle p-5">
      <h2 id="sadrzaj" className="text-lg font-semibold text-ink">
        Sadržaj
      </h2>
      <TocList entries={entries} className="mt-3 space-y-2 text-sm leading-6" />
    </nav>
  );
}

function TocList({
  entries,
  className,
}: {
  entries: readonly LegalTocEntry[];
  className: string;
}) {
  return (
    <ol className={className}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            className={clsx("rounded-sm text-brand-on-soft hover:underline", FOCUS_RING)}
          >
            {entry.title}
          </a>
          {entry.children ? (
            <TocList
              entries={entry.children}
              className="mt-2 space-y-1.5 border-l border-border-subtle pl-4"
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function LegalSection({
  entry,
  children,
}: {
  entry: LegalTocEntry;
  children: ReactNode;
}) {
  return (
    <section>
      <h2
        id={entry.id}
        className="max-w-prose scroll-mt-24 text-xl font-semibold leading-snug text-ink"
      >
        {entry.title}
      </h2>
      <div className={clsx("mt-4", BODY_CLASSES)}>{children}</div>
    </section>
  );
}

export function LegalSubsection({
  entry,
  children,
}: {
  entry: LegalTocEntry;
  children: ReactNode;
}) {
  return (
    <section className="pt-4">
      <h3
        id={entry.id}
        className="max-w-prose scroll-mt-24 text-base font-semibold leading-7 text-ink"
      >
        {entry.title}
      </h3>
      <div className={clsx("mt-2", BODY_CLASSES)}>{children}</div>
    </section>
  );
}

/**
 * A table that scrolls sideways inside its own frame on a narrow screen, so
 * the page itself never does. The first cell of each row is its header.
 */
export function LegalTable({
  label,
  columns,
  rows,
  minWidthClass,
}: {
  /** Names the scrollable region and captions the table for assistive technology. */
  label: string;
  columns: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  /** Below this width the table scrolls instead of squeezing its columns. */
  minWidthClass?: string;
}) {
  return (
    // Focusable so a keyboard user can scroll it when it overflows.
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={clsx(
        "overflow-x-auto rounded-card border border-border-subtle",
        FOCUS_RING
      )}
    >
      <table
        className={clsx("w-full border-collapse text-left text-sm leading-6", minWidthClass)}
      >
        <caption className="sr-only">{label}</caption>
        <thead className="bg-surface-sunken">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-4 py-3 font-semibold text-ink">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex} className="border-t border-border-subtle align-top">
              {cells.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row" className="px-4 py-3 font-medium text-ink">
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex} className="px-4 py-3 text-ink-secondary">
                    {cell}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MailLink({ address = LEGAL_CONTACT_EMAIL }: { address?: string }) {
  return (
    <a href={`mailto:${address}`} className={LINK_CLASSES}>
      {address}
    </a>
  );
}

/** A link to another page of this site. */
export function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={LINK_CLASSES}>
      {children}
    </Link>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className={LINK_CLASSES}>
      {children}
    </a>
  );
}

/** A storage key or cookie name; long names wrap instead of widening a table. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[0.8125rem] text-ink [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}
