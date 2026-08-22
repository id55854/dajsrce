"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Info, Mail, MapPin } from "lucide-react";
import { Badge, buttonClasses } from "@/components/ui";
import {
  REGISTRY_LINK_CLASSES,
  RegistryField,
  formatRegistryDate,
  registryStatusLabelKey,
  registryStatusTone,
  safeHttpUrl,
} from "@/components/RegistryRecord";
import { useLocale, useT } from "@/i18n/client";
import type { AssociationRegistryEntry } from "@/lib/association-registry";

/**
 * A register record inside the map's detail panel.
 *
 * Selecting a register pin used to navigate to `/organisations/[id]`, which
 * threw away the map, the viewport and the result list to show facts that fit
 * beside them. The same facts render here instead, and the full page stays one
 * click away for anyone who wants the complete record.
 *
 * The panel is narrower than that page, so it leads with what locates and
 * qualifies the organisation and leaves the exhaustive identity fields to the
 * full record.
 */
export function RegistryDetailPanel({
  organisation,
  framed = true,
}: {
  organisation: AssociationRegistryEntry;
  /** When false, the map overlay already supplies the rounded card chrome. */
  framed?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const website = safeHttpUrl(organisation.website);
  const statusKey = registryStatusLabelKey(organisation.status);
  const statusLabel = statusKey ? t(statusKey) : organisation.status;
  const place = [organisation.address, organisation.city, organisation.county]
    .filter(Boolean)
    .join(", ");
  const description = organisation.activity_description || organisation.goals;
  const hasContact = Boolean(place || website || organisation.email);
  const extraActivities =
    organisation.goals && organisation.activity_description
      ? organisation.goals
      : null;

  return (
    <div
      className={
        framed
          ? "rounded-sheet border border-border-subtle bg-surface-raised p-5 shadow-raised"
          : undefined
      }
    >
      <div className="space-y-5">
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
            {t("organisations.official_record")}
          </p>
          <h2 className="text-2xl font-bold leading-tight tracking-[-0.01em] text-ink">
            {organisation.name}
          </h2>
          {organisation.short_name ? (
            <p className="text-sm text-ink-secondary">{organisation.short_name}</p>
          ) : null}
          <Badge tone={registryStatusTone(organisation.status)}>{statusLabel}</Badge>
        </header>

        {description ? (
          <p className="text-base leading-7 text-ink-secondary">{description}</p>
        ) : null}

        {/* A register entry is not a DajSrce organisation and is not a statement
            that the organisation accepts donations. Saying so here keeps the
            panel from reading like a verified profile. */}
        <p className="flex items-start gap-2 rounded-card border border-border-subtle bg-surface-sunken p-3 text-sm text-ink-secondary">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
          {t("map_page.registry_notice")}
        </p>

        {hasContact ? (
          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink">
              {t("organisations.contact")}
            </h3>
            <ul className="space-y-3">
              {place ? (
                <ContactRow icon={MapPin} label={t("institution_detail.address")}>
                  {place}
                </ContactRow>
              ) : null}
              {organisation.email ? (
                <ContactRow icon={Mail} label={t("institution_detail.email")}>
                  <a href={`mailto:${organisation.email}`} className={REGISTRY_LINK_CLASSES}>
                    {organisation.email}
                  </a>
                </ContactRow>
              ) : null}
              {website ? (
                <ContactRow icon={ExternalLink} label={t("institution_detail.website")}>
                  <a
                    href={website}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className={REGISTRY_LINK_CLASSES}
                  >
                    {website}
                  </a>
                </ContactRow>
              ) : null}
            </ul>
          </section>
        ) : null}

        {extraActivities || organisation.target_groups ? (
          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink">
              {t("organisations.activity")}
            </h3>
            <dl className="space-y-3">
              <RegistryField label={t("organisations.goals")} value={extraActivities} />
              <RegistryField
                label={t("organisations.target_groups")}
                value={organisation.target_groups}
              />
            </dl>
          </section>
        ) : null}

        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink">
            {t("organisations.registry_identity")}
          </h3>
          <dl className="space-y-3">
            <RegistryField
              label="OIB"
              value={organisation.oib || t("organisations.missing_oib")}
            />
            <RegistryField
              label={t("organisations.registry_number")}
              value={organisation.registry_number}
            />
            <RegistryField
              label={t("organisations.registered")}
              value={formatRegistryDate(locale, organisation.registered_on)}
            />
          </dl>
        </section>

        <Link
          href={`/organisations/${encodeURIComponent(organisation.id)}`}
          className={buttonClasses({ variant: "secondary", size: "sm", className: "w-full" })}
        >
          {t("map_page.open_full_record")}
        </Link>
      </div>
    </div>
  );
}

function ContactRow({
  icon: Icon,
  label,
  children,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-ink-tertiary" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
          {label}
        </p>
        <div className="break-words text-sm leading-6 text-ink">{children}</div>
      </div>
    </li>
  );
}
