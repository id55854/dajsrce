"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { usePathname } from "next/navigation";
import { ORGANISATION, organisationAddressLine } from "@/lib/organisation";
import { useLocale, useT } from "@/i18n/client";

// The map is a fixed-height, full-viewport application surface. Rendering the
// global footer under it makes the document taller than the viewport, so the
// page scrolls and wheel/touch scrolling over the map zooms it instead. The
// footer is mounted from the root layout, so the route exclusion lives here.
//
// The map now *is* the home page, so `/` is on this list. It carries the
// registered name itself, in the compact strip below its own chrome
// (`MapLegalStrip`), which is why excluding it here does not hide the
// association's identity from the front page.
function isMapRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/map" || pathname.startsWith("/map/");
}

// "O nama" and the three legal documents, in the order a reader looks for them.
// The legal pages have to be reachable from every page (GDPR Art. 12, DSA
// Art. 14), so the map carries the two that matter most in its own strip.
const FOOTER_LINKS = [
  { href: "/o-nama", labelKey: "nav.about" },
  { href: "/pravila-privatnosti", labelKey: "legal.privacy" },
  { href: "/uvjeti-koristenja", labelKey: "legal.terms" },
  { href: "/kolacici", labelKey: "legal.cookies" },
] as const;

const MAP_STRIP_LINKS = [
  { href: "/o-nama", labelKey: "nav.about" },
  { href: "/pravila-privatnosti", labelKey: "legal.privacy_short" },
  { href: "/uvjeti-koristenja", labelKey: "legal.terms_short" },
] as const;

export function Footer() {
  const t = useT();
  const { locale } = useLocale();
  const pathname = usePathname();
  const year = new Date().getFullYear();

  if (isMapRoute(pathname)) return null;

  return (
    <footer className="border-t border-border-subtle bg-surface-sunken py-8 text-ink-secondary">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 text-center sm:px-6 lg:px-8">
        <p className="flex flex-wrap items-center justify-center gap-2 text-sm text-ink sm:text-base">
          <span className="font-medium">{ORGANISATION.shortName}</span>
          <Heart className="inline h-4 w-4 fill-brand text-brand" strokeWidth={2} aria-hidden />
          <span>{t("footer.tagline")}</span>
        </p>

        {/* The registered identity. Marked up as an address so it is exposed as
            contact information rather than as a run of decorative small print. */}
        <address className="not-italic text-sm leading-relaxed">
          <span className="block font-semibold uppercase tracking-wide text-ink">
            {ORGANISATION.legalName}
          </span>
          <span className="block">{organisationAddressLine(locale)}</span>
          <span className="block tabular-nums">
            {t("footer.oib")}: {ORGANISATION.oib} · {t("footer.registration_number")}:{" "}
            {ORGANISATION.registrationNumber} · {t("footer.registry_number")}:{" "}
            {ORGANISATION.registryNumber}
          </span>
        </address>

        {ORGANISATION.contactEmail ? (
          <p className="text-sm">
            <span className="text-ink-tertiary">{t("footer.contact_label")}: </span>
            <a
              href={`mailto:${ORGANISATION.contactEmail}`}
              className="rounded font-semibold text-brand underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              {ORGANISATION.contactEmail}
            </a>
          </p>
        ) : null}

        <nav aria-label={t("legal.footer_nav_label")}>
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {FOOTER_LINKS.map(({ href, labelKey }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="rounded-control text-sm font-semibold text-brand underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  {t(labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <p className="text-sm">{t("footer.public_good", { year })}</p>
      </div>
    </footer>
  );
}

/**
 * The registered name on the map surface.
 *
 * The map fills the viewport, so it cannot carry the footer, but the
 * association still has to be identifiable on its own front page. This is one
 * line in the layout flow beneath the map (not an overlay), so it never
 * collides with the bottom sheet on phones or with Leaflet's attribution, and
 * the page still does not scroll.
 */
export function MapLegalStrip() {
  const t = useT();
  const contactEmail = ORGANISATION.contactEmail;
  return (
    // Phones keep every pixel for the map and sheet; the same identity is on
    // /o-nama, which the phone menu links to.
    <div className="hidden h-8 shrink-0 items-center justify-center gap-2 overflow-hidden border-t border-border-subtle bg-surface px-3 md:flex">
      <p className="truncate text-[11px] leading-none text-ink-secondary">
        <span className="font-semibold uppercase tracking-wide">
          {ORGANISATION.legalName}
        </span>
        <span aria-hidden> · </span>
        <span className="tabular-nums">
          {t("footer.oib")} {ORGANISATION.oib}
        </span>
        {/* Inside the truncating line, not beside it: on a narrow phone the
            registered name is the part that must survive, so the address is
            what gets clipped. The label is dropped for width; a mailto link
            reading as an address needs none; and restored for screen readers. */}
        {contactEmail ? (
          <>
            <span aria-hidden> · </span>
            <a
              href={`mailto:${contactEmail}`}
              aria-label={`${t("footer.contact_label")}: ${contactEmail}`}
              className="rounded font-medium underline-offset-2 transition-colors hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {contactEmail}
            </a>
          </>
        ) : null}
      </p>
      <nav aria-label={t("legal.footer_nav_label")} className="flex shrink-0 items-center gap-3">
        {MAP_STRIP_LINKS.map(({ href, labelKey }) => (
          <Link
            key={href}
            href={href}
            className="shrink-0 rounded text-[11px] font-semibold leading-none text-brand underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {t(labelKey)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
