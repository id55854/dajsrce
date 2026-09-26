"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowRight, BadgeCheck, Building2, HandHeart, MapPin, Sprout } from "lucide-react";
import { useT } from "@/i18n/client";
import type { EngagedAssociationItem, EngagedDirectoryResponse } from "@/lib/association-registry";
import { Badge, buttonClasses } from "@/components/ui";

const ORGANISATION_LIMIT = 6;

/**
 * What the giving page says while there is little or nothing to give to.
 *
 * On launch day almost every association is still claiming its profile, and
 * a bare "no active needs" read as a broken page to donors arriving from the
 * announcement. This says honestly why the list is short, offers the other
 * ways to help, asks associations to register, and lists the organisations
 * whose claim has already been reviewed. That list comes from the engaged
 * directory filtered to verified accounts, never from register classification,
 * which is not an organisation's confirmation of anything.
 */
export function LaunchNotice({ hasNeeds, className }: { hasNeeds: boolean; className?: string }) {
  const t = useT();
  const [organisations, setOrganisations] = useState<EngagedAssociationItem[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ verified: "true", pageSize: String(ORGANISATION_LIMIT) });
    fetch(`/api/v1/organisations/engaged?${params}`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<EngagedDirectoryResponse>) : null))
      .then((json) => {
        const items = (json?.items ?? []).filter((item) => item.is_verified && item.institution_id);
        setOrganisations(items.slice(0, ORGANISATION_LIMIT));
      })
      .catch(() => {
        // The list is a bonus; without it the notice still says what to do.
      });
    return () => controller.abort();
  }, []);

  return (
    <section
      aria-labelledby="launch-notice-title"
      className={clsx("rounded-card border border-border-subtle bg-surface-raised p-5 shadow-raised sm:p-6", className)}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-on-soft"
        >
          <Sprout className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id="launch-notice-title" className="text-lg font-semibold text-ink">
            {t(hasNeeds ? "needs_page.launch_title_few" : "needs_page.launch_title_empty")}
          </h2>
          <p className="mt-1 max-w-2xl text-base leading-7 text-ink-secondary">{t("needs_page.launch_body")}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Link href="/" className={buttonClasses({ variant: "secondary" })}>
          <MapPin className="h-4 w-4" aria-hidden="true" />
          {t("needs_page.launch_map")}
        </Link>
        <Link href="/volunteer" className={buttonClasses({ variant: "secondary" })}>
          <HandHeart className="h-4 w-4" aria-hidden="true" />
          {t("needs_page.launch_volunteer")}
        </Link>
      </div>

      {organisations.length > 0 ? (
        <div className="mt-6 border-t border-border-subtle pt-5">
          <h3 className="text-base font-semibold text-ink">{t("needs_page.launch_verified_title")}</h3>
          <p className="mt-1 text-sm text-ink-secondary">{t("needs_page.launch_verified_body")}</p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {organisations.map((organisation) => (
              <li key={organisation.institution_id}>
                <Link
                  href={`/institution/${organisation.institution_id}`}
                  className="group flex h-full items-start gap-3 rounded-control border border-border-subtle p-3 transition-colors hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink group-hover:text-brand">
                      {organisation.name}
                    </span>
                    {organisation.city ? (
                      <span className="block text-xs text-ink-secondary">{organisation.city}</span>
                    ) : null}
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge
                        size="sm"
                        tone="success"
                        icon={<BadgeCheck className="h-3 w-3" aria-hidden="true" />}
                      >
                        {t("needs_page.launch_verified_badge")}
                      </Badge>
                      {organisation.open_needs > 0 ? (
                        <Badge size="sm" tone="brand">
                          {t("needs_page.launch_open_needs", { count: organisation.open_needs })}
                        </Badge>
                      ) : null}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-2 rounded-control bg-surface-sunken p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-secondary">
          <span className="font-semibold text-ink">{t("needs_page.launch_ngo_title")}</span>{" "}
          {t("needs_page.launch_ngo_body")}
        </p>
        <Link
          href="/auth/register?role=ngo"
          className={buttonClasses({ size: "sm", className: "shrink-0" })}
        >
          {t("needs_page.launch_ngo_action")}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
