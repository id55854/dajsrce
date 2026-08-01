"use client";

import type { ReactNode } from "react";
import type { Institution } from "@/lib/types";
import type { PublicInstitutionDetail } from "@/lib/location-map";
import { getCategoryConfig, DONATION_TYPES } from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Package,
  Phone,
  Train,
  Users,
  X,
} from "lucide-react";

export interface InstitutionDetailPanelProps {
  institution: Institution | PublicInstitutionDetail;
  onClose?: () => void;
  /** When false, hides the close control (e.g. standalone public page). */
  showCloseButton?: boolean;
}

function normalizeWebsiteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

export function InstitutionDetailPanel({
  institution,
  onClose,
  showCloseButton = true,
}: InstitutionDetailPanelProps) {
  const t = useT();
  const { locale } = useLocale();
  const isPublicDetail = "latitude" in institution;
  const isLocationHidden = isPublicDetail
    ? institution.isLocationHidden
    : institution.is_location_hidden;
  const approximateArea = isPublicDetail
    ? institution.approximateArea
    : institution.approximate_area;
  const isVerified = isPublicDetail
    ? institution.isVerified
    : institution.is_verified;
  const workingHours = isPublicDetail
    ? institution.workingHours
    : institution.working_hours;
  const dropOffHours = isPublicDetail
    ? institution.dropOffHours
    : institution.drop_off_hours;
  const acceptsDonations = isPublicDetail
    ? institution.acceptsDonations
    : institution.accepts_donations;
  const nearestZetStop = isPublicDetail
    ? institution.nearestZetStop
    : institution.nearest_zet_stop;
  const zetLines = isPublicDetail ? institution.zetLines : institution.zet_lines;
  const latitude = isPublicDetail ? institution.latitude : institution.lat;
  const longitude = isPublicDetail ? institution.longitude : institution.lng;
  const cat = getCategoryConfig(institution.category);
  const addressDisplay = isLocationHidden
    ? t("institution_detail.hidden_address", {
        area: approximateArea ?? institution.city ?? t("map_ui.approximate_area"),
      })
    : [institution.address, institution.city].filter(Boolean).join(", ");
  const noValue = "—";

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  const telHref = institution.phone
    ? `tel:${institution.phone.replace(/\s/g, "")}`
    : null;

  return (
    <div className="relative rounded-xl border border-gray-100 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
      {showCloseButton ? (
        <button
          type="button"
          onClick={() => onClose?.()}
          className="absolute right-3 top-3 z-10 rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          aria-label={t("institution_detail.close")}
        >
          <X className="h-5 w-5" />
        </button>
      ) : null}

      <div>
        {isLocationHidden ? (
          <div className="border-b border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
            {t("institution_detail.hidden_notice")}
          </div>
        ) : null}

        <div
          className={
            showCloseButton
              ? "space-y-5 p-4 pr-12 sm:p-5 sm:pr-14"
              : "space-y-5 p-4 sm:p-5"
          }
        >
          <header className="space-y-3">
            <span
              className="inline-flex rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                color: cat.color,
                backgroundColor: cat.bgColor,
              }}
            >
              {locale === "hr" ? cat.labelHr : cat.label}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-[family-name:var(--font-dm-sans)] text-2xl font-bold text-gray-900 dark:text-gray-100">
                {institution.name}
              </h2>
              {isVerified ? (
                <CheckCircle2
                  className="h-6 w-6 shrink-0 text-emerald-500"
                  aria-label={t("institution_detail.verified")}
                />
              ) : null}
            </div>
          </header>

          <p className="text-gray-700 dark:text-gray-300">
            {institution.description}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InfoItem
              icon={MapPin}
              label={t("institution_detail.address")}
              value={addressDisplay}
            />
            <InfoItem
              icon={Phone}
              label={t("institution_detail.phone")}
              value={
                institution.phone ? (
                  <a
                    href={telHref!}
                    className="text-red-500 underline-offset-2 hover:underline"
                  >
                    {institution.phone}
                  </a>
                ) : (
                  noValue
                )
              }
            />
            <InfoItem
              icon={Mail}
              label={t("institution_detail.email")}
              value={
                institution.email ? (
                  <a
                    href={`mailto:${institution.email}`}
                    className="text-red-500 underline-offset-2 hover:underline"
                  >
                    {institution.email}
                  </a>
                ) : (
                  noValue
                )
              }
            />
            <InfoItem
              icon={Globe}
              label={t("institution_detail.website")}
              value={
                institution.website ? (
                  <a
                    href={normalizeWebsiteUrl(institution.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-500 underline-offset-2 hover:underline"
                  >
                    {institution.website}
                  </a>
                ) : (
                  noValue
                )
              }
            />
            <InfoItem
              icon={Clock}
              label={t("institution_detail.working_hours")}
              value={workingHours ?? noValue}
            />
            <InfoItem
              icon={Package}
              label={t("institution_detail.dropoff_hours")}
              value={dropOffHours ?? noValue}
            />
          </div>

          <section>
            <h3 className="mb-2 font-[family-name:var(--font-dm-sans)] text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("institution_detail.accepts")}
            </h3>
            <DonationBadges accepts={acceptsDonations} />
          </section>

          {institution.capacity ? (
            <div className="flex items-start gap-3 rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
              <Users className="mt-0.5 h-5 w-5 shrink-0 text-gray-500" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t("institution_detail.capacity")}
                </p>
                <p className="text-sm text-gray-800 dark:text-gray-200">
                  {institution.capacity}
                </p>
              </div>
            </div>
          ) : null}

          {nearestZetStop ? (
            <section className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 dark:border-gray-800 dark:bg-gray-800/80">
              <h3 className="mb-2 flex items-center gap-2 font-[family-name:var(--font-dm-sans)] text-sm font-semibold text-gray-900 dark:text-gray-100">
                <Train className="h-4 w-4 text-gray-600" />
                {t("institution_detail.nearby_stop")}
              </h3>
              <p className="text-sm text-gray-800 dark:text-gray-200">
                {nearestZetStop}
              </p>
              {zetLines ? (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {t("institution_detail.lines", { lines: zetLines })}
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="flex flex-wrap gap-3 pt-1">
            {!isLocationHidden ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 min-w-[10rem] items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
              >
                <ExternalLink className="h-4 w-4" />
                {t("institution_detail.open_maps")}
              </a>
            ) : null}
            {institution.phone ? (
              <a
                href={telHref!}
                className="inline-flex flex-1 min-w-[10rem] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
              >
                <Phone className="h-4 w-4" />
                {t("institution_detail.call")}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </p>
        <div className="break-words text-sm text-gray-800 dark:text-gray-200">
          {value}
        </div>
      </div>
    </div>
  );
}

function DonationBadges({
  accepts,
}: {
  accepts: Institution["accepts_donations"];
}) {
  const t = useT();
  const { locale } = useLocale();
  if (!accepts || accepts.length === 0) {
    return (
      <p className="text-sm italic text-gray-500 dark:text-gray-400">
        {t("institution_detail.contact_accepts")}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {accepts.map((type) => {
        const dt = DONATION_TYPES[type];
        if (!dt) return null;
        return (
          <span
            key={type}
            className="rounded-full border border-red-100 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
          >
            {locale === "hr" ? dt.labelHr : dt.label}
          </span>
        );
      })}
    </div>
  );
}
