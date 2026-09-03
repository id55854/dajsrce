"use client";

import type { ComponentType, CSSProperties, ReactNode } from "react";
import type { Institution } from "@/lib/types";
import type { PublicInstitutionDetail } from "@/lib/location-map";
import { getCategoryConfig, DONATION_TYPES } from "@/lib/constants";
import { Badge, Skeleton, buttonClasses } from "@/components/ui";
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
  /**
   * When false, skip the card chrome; the map overlay already is the card.
   * The standalone page keeps the default framed look.
   */
  framed?: boolean;
}

function normalizeWebsiteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

export function InstitutionDetailPanel({
  institution,
  onClose,
  showCloseButton = true,
  framed = true,
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
  // Publish the category hue for `category-chip` to mix against the theme, via
  // the fallback-safe config so an unrecognised category still gets a colour.
  const categoryStyle = { "--cat": cat.color } as CSSProperties;
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
  const actionClasses = "min-w-[10rem] flex-1";

  return (
    <div
      className={
        framed
          ? "@container relative rounded-card border border-border-subtle bg-surface-raised shadow-raised"
          : "@container relative"
      }
    >
      {showCloseButton ? (
        <button
          type="button"
          onClick={() => onClose?.()}
          className="absolute right-2 top-2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink motion-safe:active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          aria-label={t("institution_detail.close")}
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      ) : null}

      <div>
        {isLocationHidden ? (
          <div
            className={
              framed
                ? "rounded-t-card border-b border-border-subtle bg-warning-soft px-4 py-3 text-sm text-warning-on-soft"
                : "mb-5 rounded-card border border-border-subtle bg-warning-soft px-4 py-3 text-sm text-warning-on-soft"
            }
          >
            {t("institution_detail.hidden_notice")}
          </div>
        ) : null}

        <div
          className={
            showCloseButton
              ? "space-y-5 p-4 pr-14 sm:p-5 sm:pr-16"
              : framed
                ? "space-y-5 p-4 sm:p-5"
                : "space-y-5"
          }
        >
          <header className="space-y-3">
            <span
              className="category-chip inline-flex rounded-full px-3 py-1 text-xs font-semibold"
              style={categoryStyle}
            >
              {locale === "hr" ? cat.labelHr : cat.label}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold leading-tight tracking-[-0.01em] text-ink">
                {institution.name}
              </h2>
              {isVerified ? (
                <CheckCircle2
                  className="h-6 w-6 shrink-0 text-success"
                  aria-label={t("institution_detail.verified")}
                />
              ) : null}
            </div>
          </header>

          <p className="text-ink-secondary">{institution.description}</p>

          {/* Keyed off the panel's own width, not the viewport: this panel is a
              ~307px column on the map split and full width on the public page. */}
          <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
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
                    className="rounded text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
                    className="rounded text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
                    className="rounded text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
            <h3 className="mb-2 text-sm font-semibold text-ink">
              {t("institution_detail.accepts")}
            </h3>
            <DonationBadges accepts={acceptsDonations} />
          </section>

          {institution.capacity ? (
            <div className="flex items-start gap-3 rounded-card bg-surface-sunken p-3">
              <Users className="mt-0.5 h-5 w-5 shrink-0 text-ink-tertiary" aria-hidden />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
                  {t("institution_detail.capacity")}
                </p>
                <p className="text-sm text-ink">{institution.capacity}</p>
              </div>
            </div>
          ) : null}

          {nearestZetStop ? (
            <section className="rounded-card border border-border-subtle bg-surface-sunken p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                <Train className="h-4 w-4 text-ink-tertiary" aria-hidden />
                {t("institution_detail.nearby_stop")}
              </h3>
              <p className="text-sm text-ink">{nearestZetStop}</p>
              {zetLines ? (
                <p className="mt-1 text-sm text-ink-secondary">
                  {t("institution_detail.lines", { lines: zetLines })}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* One primary action per surface. Directions is the action for a
              place you can visit; when the address is protected, calling is the
              only way in, so it takes the primary slot instead. */}
          <div className="flex flex-wrap gap-3 pt-1">
            {!isLocationHidden ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({
                  variant: "primary",
                  className: actionClasses,
                })}
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                {t("institution_detail.open_maps")}
              </a>
            ) : null}
            {institution.phone ? (
              <a
                href={telHref!}
                className={buttonClasses({
                  variant: isLocationHidden ? "primary" : "secondary",
                  className: actionClasses,
                })}
              >
                <Phone className="h-4 w-4" aria-hidden />
                {t("institution_detail.call")}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Stands in for the real panel's structure, category chip, display heading,
 * description, the six-field grid and two actions, rather than two grey bars.
 */
export function InstitutionDetailSkeleton({ framed = true }: { framed?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={
        framed
          ? "rounded-card border border-border-subtle bg-surface-raised p-4 shadow-raised sm:p-5"
          : undefined
      }
    >
      <Skeleton className="h-6 w-32 rounded-full" />
      <Skeleton className="mt-3 h-7 w-3/4" />
      <div className="mt-4 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Skeleton className="h-11 min-w-[10rem] flex-1 rounded-full" />
        <Skeleton className="h-11 min-w-[10rem] flex-1 rounded-full" />
      </div>
    </div>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-ink-tertiary" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
          {label}
        </p>
        <div className="break-words text-sm text-ink">{value}</div>
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
      <p className="text-sm italic text-ink-tertiary">
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
          <Badge key={type} tone="brand">
            {locale === "hr" ? dt.labelHr : dt.label}
          </Badge>
        );
      })}
    </div>
  );
}
