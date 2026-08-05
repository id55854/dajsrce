"use client";

import type { CSSProperties } from "react";
import type { Institution } from "@/lib/types";
import type { PublicMapInstitution } from "@/lib/location-map";
import { getCategoryConfig, DONATION_TYPES } from "@/lib/constants";
import { formatDistance } from "@/lib/utils";
import { Badge, Skeleton } from "@/components/ui";
import {
  Apple,
  Baby,
  BadgeCheck,
  Banknote,
  BedDouble,
  BookOpen,
  Clock,
  Droplets,
  Navigation,
  Pencil,
  Shirt,
  Sofa,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { useLocale, useT } from "@/i18n/client";

const DONATION_ICONS: Record<string, LucideIcon> = {
  Apple,
  Baby,
  Banknote,
  BedDouble,
  BookOpen,
  Clock,
  Droplets,
  Pencil,
  Shirt,
  Sofa,
  Stethoscope,
};

type InstitutionCardProps = {
  institution: Institution | PublicMapInstitution;
  isSelected: boolean;
  onClick: () => void;
  distanceKm?: number | null;
};

export function InstitutionCard({
  institution,
  isSelected,
  onClick,
  distanceKm = null,
}: InstitutionCardProps) {
  const t = useT();
  const { locale } = useLocale();
  const isMapInstitution = "kind" in institution;
  const acceptsDonations = isMapInstitution
    ? institution.acceptsDonations
    : institution.accepts_donations;
  const isVerified = isMapInstitution
    ? institution.isVerified
    : institution.is_verified;
  const isLocationHidden = isMapInstitution
    ? institution.isLocationHidden
    : institution.is_location_hidden;
  const approximateArea = isMapInstitution
    ? institution.approximateArea
    : institution.approximate_area;
  const isApproximateRegistryLocation = isMapInstitution &&
    institution.entityType === "registry" &&
    (institution.locationPrecision === "city" || institution.locationPrecision === "county");
  const cat = getCategoryConfig(institution.category);
  // Same contract as `categoryVars()` — publish the hue and let the
  // `category-chip` class mix it against the theme's surface and ink — but
  // sourced from `getCategoryConfig` so a category newer than this deploy still
  // resolves to a colour instead of throwing.
  const categoryStyle = { "--cat": cat.color } as CSSProperties;

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={onClick}
      className={clsx(
        "w-full rounded-card border bg-surface-raised p-4 text-left shadow-raised",
        "transition-[box-shadow,transform,border-color] duration-150 ease-out",
        "hover:border-border-strong hover:shadow-overlay motion-safe:active:scale-[0.99]",
        "ring-offset-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        isSelected
          ? "border-brand ring-2 ring-brand ring-offset-2"
          : "border-border-subtle"
      )}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <span
          className="category-chip inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
          style={categoryStyle}
        >
          {locale === "hr" ? cat.labelHr : cat.label}
        </span>
        <div className="flex items-center gap-2">
          {distanceKm != null ? (
            <Badge
              tone="info"
              size="sm"
              icon={<Navigation className="h-3 w-3" strokeWidth={2.5} aria-hidden />}
              className="whitespace-nowrap"
            >
              <span title={t("map_ui.distance")}>{formatDistance(distanceKm)}</span>
            </Badge>
          ) : null}
          {isVerified ? (
            <span className="inline-flex items-center text-success" title={t("map_ui.verified")}>
              <BadgeCheck className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
            </span>
          ) : null}
        </div>
      </div>

      {/* Long Croatian names used to wrap to four lines and break the rhythm the
          list skeleton assumes. */}
      <h3 className="line-clamp-2 font-semibold leading-snug text-ink">
        {institution.name}
      </h3>
      <p className="mt-1 line-clamp-2 text-sm text-ink-secondary">
        {isApproximateRegistryLocation || isLocationHidden
          ? approximateArea ?? institution.city ?? t("map_ui.approximate_area")
          : institution.address}
        {!isLocationHidden && !isApproximateRegistryLocation && institution.city
          ? `, ${institution.city}`
          : ""}
      </p>

      {isLocationHidden || isApproximateRegistryLocation ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {isLocationHidden ? (
            <Badge tone="warning" size="sm">
              {t("map_ui.hidden_location")}
            </Badge>
          ) : null}
          {isApproximateRegistryLocation ? (
            <Badge tone="neutral" size="sm">
              {t("map_ui.registry_approximate")}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {acceptsDonations.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {acceptsDonations.map((donationType) => {
            const donation = DONATION_TYPES[donationType];
            if (!donation) return null;
            const DonationIcon = DONATION_ICONS[donation.icon];
            return (
              <span
                key={donationType}
                className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-ink-secondary"
              >
                {DonationIcon ? (
                  <DonationIcon className="h-3.5 w-3.5 text-ink-tertiary" aria-hidden />
                ) : null}
                {locale === "hr" ? donation.labelHr : donation.label}
              </span>
            );
          })}
        </div>
      ) : null}
    </button>
  );
}

/**
 * Mirrors the real card's blocks — chip row, two-line title, address, donation
 * chips — so a cold load does not resolve into a different shape.
 */
export function InstitutionCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="rounded-card border border-border-subtle bg-surface-raised p-4 shadow-raised"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="mt-2 h-3.5 w-3/5" />
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
    </div>
  );
}
