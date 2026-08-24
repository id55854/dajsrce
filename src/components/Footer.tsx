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
            {ORGANISATION.registrationNumber}
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

        <Link
          href="/o-nama"
          className="rounded-control text-sm font-semibold text-brand underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {t("nav.about")}
        </Link>

        <p className="text-sm">{t("footer.public_good", { year })}</p>
      </div>
    </footer>
  );
}

/**
 * The registered name on the map surface.
 *
 * The map fills the viewport, so it cannot carry the footer — but the
 * association still has to be identifiable on its own front page. This is one
 * line in the layout flow beneath the map (not an overlay), so it never
 * collides with the bottom sheet on phones or with Leaflet's attribution, and
 * the page still does not scroll.
 */
export function MapLegalStrip() {
  const t = useT();
  return (
    <div className="flex h-8 shrink-0 items-center justify-center gap-2 overflow-hidden border-t border-border-subtle bg-surface px-3">
      <p className="truncate text-[11px] leading-none text-ink-secondary">
        <span className="font-semibold uppercase tracking-wide">
          {ORGANISATION.legalName}
        </span>
        <span aria-hidden> · </span>
        <span className="tabular-nums">
          {t("footer.oib")} {ORGANISATION.oib}
        </span>
      </p>
      <Link
        href="/o-nama"
        className="shrink-0 rounded text-[11px] font-semibold leading-none text-brand underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {t("nav.about")}
      </Link>
    </div>
  );
}
