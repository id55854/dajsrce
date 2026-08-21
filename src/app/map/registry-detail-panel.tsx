"use client";

import Link from "next/link";
import { ExternalLink, Info, Mail, MapPin } from "lucide-react";
import { Badge, SectionHeader, buttonClasses } from "@/components/ui";
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
}: {
  organisation: AssociationRegistryEntry;
}) {
  const t = useT();
  const { locale } = useLocale();
  const website = safeHttpUrl(organisation.website);
  const statusKey = registryStatusLabelKey(organisation.status);
  const statusLabel = statusKey ? t(statusKey) : organisation.status;
  const place = [organisation.address, organisation.city, organisation.county]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
          {t("organisations.official_record")}
        </p>
        <h2 className="mt-1 text-lg font-semibold leading-tight text-ink">
          {organisation.name}
        </h2>
        {organisation.short_name ? (
          <p className="mt-1 text-sm text-ink-secondary">{organisation.short_name}</p>
        ) : null}
        <div className="mt-2">
          <Badge tone={registryStatusTone(organisation.status)}>{statusLabel}</Badge>
        </div>
      </div>

      {/* A register entry is not a DajSrce organisation and is not a statement
          that the organisation accepts donations. Saying so here keeps the
          panel from reading like a verified profile. */}
      <p className="flex items-start gap-2 rounded-card border border-border-subtle bg-surface-sunken p-3 text-sm text-ink-secondary">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
        {t("map_page.registry_notice")}
      </p>

      {place ? (
        <p className="flex items-start gap-2 text-base leading-6 text-ink">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
          {place}
        </p>
      ) : null}

      {organisation.goals || organisation.target_groups || organisation.activity_description ? (
        <section>
          <SectionHeader title={t("organisations.activity")} />
          <dl className="mt-3 space-y-3">
            <RegistryField label={t("organisations.goals")} value={organisation.goals} />
            <RegistryField
              label={t("organisations.target_groups")}
              value={organisation.target_groups}
            />
            <RegistryField
              label={t("organisations.activity_description")}
              value={organisation.activity_description}
            />
          </dl>
        </section>
      ) : null}

      <section>
        <SectionHeader title={t("organisations.registry_identity")} />
        <dl className="mt-3 space-y-3">
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

      {website || organisation.email ? (
        <section>
          <SectionHeader title={t("organisations.contact")} />
          <ul className="mt-3 space-y-2 text-base leading-6">
            {website ? (
              <li className="flex items-start gap-2">
                <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className={REGISTRY_LINK_CLASSES}
                >
                  {website}
                </a>
              </li>
            ) : null}
            {organisation.email ? (
              <li className="flex items-start gap-2">
                <Mail className="mt-1 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
                <a href={`mailto:${organisation.email}`} className={REGISTRY_LINK_CLASSES}>
                  {organisation.email}
                </a>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <Link
        href={`/organisations/${encodeURIComponent(organisation.id)}`}
        className={buttonClasses({ variant: "secondary", size: "sm", className: "w-full" })}
      >
        {t("map_page.open_full_record")}
      </Link>
    </div>
  );
}
