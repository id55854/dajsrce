"use client";

import type { Institution } from "@/lib/types";
import type { PublicMapInstitution } from "@/lib/location-map";
import { getCategoryConfig, DONATION_TYPES } from "@/lib/constants";
import { formatDistance } from "@/lib/utils";
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

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={onClick}
      className={clsx(
        "w-full rounded-xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-all hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:shadow-gray-900",
        isSelected && "ring-2 ring-red-500 ring-offset-2"
      )}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <span
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: cat.bgColor, color: cat.color }}
        >
          {locale === "hr" ? cat.labelHr : cat.label}
        </span>
        <div className="flex items-center gap-2">
          {distanceKm != null ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              title={t("map_ui.distance")}
            >
              <Navigation className="h-3 w-3" strokeWidth={2.5} />
              {formatDistance(distanceKm)}
            </span>
          ) : null}
          {isVerified ? (
            <span className="inline-flex items-center gap-0.5 text-emerald-600" title={t("map_ui.verified")}>
              <BadgeCheck className="h-5 w-5 shrink-0" strokeWidth={2} />
            </span>
          ) : null}
        </div>
      </div>

      <h3 className="font-semibold text-gray-900 dark:text-gray-100">
        {institution.name}
      </h3>
      <p className="mt-1 text-sm text-gray-500 line-clamp-2 dark:text-gray-400">
        {isApproximateRegistryLocation
          ? approximateArea ?? institution.city ?? t("map_ui.approximate_area")
          : isLocationHidden
          ? approximateArea ?? institution.city ?? t("map_ui.approximate_area")
          : institution.address}
        {!isLocationHidden && !isApproximateRegistryLocation && institution.city
          ? `, ${institution.city}`
          : ""}
      </p>

      {isLocationHidden ? (
        <span className="mt-2 inline-block rounded-full bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-700">
          {t("map_ui.hidden_location")}
        </span>
      ) : null}

      {isApproximateRegistryLocation ? (
        <span className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {t("map_ui.registry_approximate")}
        </span>
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
                className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              >
                {DonationIcon ? (
                  <DonationIcon className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
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
