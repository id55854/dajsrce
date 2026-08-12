"use client";

import type { ReactNode } from "react";
import { CalendarClock, MapPin, Package } from "lucide-react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { enUS, hr } from "date-fns/locale";
import { DONATION_TYPES } from "@/lib/constants";
import type { OfferStatus, PublicOffer } from "@/lib/offers";
import { useLocale, useT } from "@/i18n/client";
import { Badge, Card, type BadgeTone } from "@/components/ui";
import { DonationTypeIcon } from "@/components/DonationTypeIcon";

const STATUS: Record<OfferStatus, { key: string; tone: BadgeTone }> = {
  open: { key: "offers.status_open", tone: "success" },
  claimed: { key: "offers.status_claimed", tone: "brand" },
  fulfilled: { key: "offers.status_fulfilled", tone: "info" },
  withdrawn: { key: "offers.status_withdrawn", tone: "neutral" },
  expired: { key: "offers.status_expired", tone: "warning" },
};

/**
 * One offer, as everyone sees it.
 *
 * The props type is `PublicOffer` on purpose: that shape has no author id, no
 * address and no exact coordinate, so this component cannot render a private
 * individual's location however it is used. The coarse point exists in the data
 * but is deliberately not drawn here — `city` is the only place shown.
 */
export function OfferCard({
  offer,
  badges,
  action,
  className,
  children,
}: {
  offer: PublicOffer;
  /** Extra badges rendered after the status and donation type. */
  badges?: ReactNode;
  /** Footer control — a claim button, a decision row, a status note. */
  action?: ReactNode;
  className?: string;
  /** Rendered below the footer, e.g. the author's list of incoming claims. */
  children?: ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const status = STATUS[offer.status];
  const donation = DONATION_TYPES[offer.donation_type];
  const dateLocale = locale === "hr" ? hr : enUS;

  const posted = offer.created_at
    ? formatDistanceToNow(new Date(offer.created_at), {
        addSuffix: true,
        locale: dateLocale,
      })
    : "";

  const availableUntil = offer.available_until
    ? new Date(`${offer.available_until}T00:00:00.000Z`).toLocaleDateString(
        locale === "hr" ? "hr-HR" : "en-GB",
        { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
      )
    : null;

  return (
    <Card as="article" className={clsx("flex h-full flex-col", className)}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={status.tone}>{t(status.key)}</Badge>
        <Badge
          icon={
            <DonationTypeIcon type={offer.donation_type} className="h-3.5 w-3.5" />
          }
        >
          {locale === "hr" ? donation.labelHr : donation.label}
        </Badge>
        {badges}
      </div>

      <h3 className="line-clamp-2 text-lg font-semibold leading-snug text-ink">
        {offer.title}
      </h3>
      {offer.description ? (
        <p className="mt-2 line-clamp-4 text-base leading-6 text-ink-secondary">
          {offer.description}
        </p>
      ) : null}

      <dl className="mt-4 space-y-1.5 text-sm text-ink-secondary">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
          <dt className="sr-only">{t("offers.form_quantity_label")}</dt>
          <dd>
            {t("offers.quantity_summary", {
              quantity: offer.quantity,
              unit: offer.unit ?? "",
            }).trim()}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
          <dt className="sr-only">{t("offers.approximate_location")}</dt>
          <dd>{offer.city}</dd>
        </div>
        {availableUntil ? (
          <div className="flex items-center gap-2">
            <CalendarClock
              className="h-4 w-4 shrink-0 text-ink-tertiary"
              aria-hidden="true"
            />
            <dt className="sr-only">{t("offers.form_available_until_label")}</dt>
            <dd>{t("offers.available_until", { date: availableUntil })}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
        {action ?? <span />}
        {posted ? (
          <time className="text-sm text-ink-tertiary" dateTime={offer.created_at}>
            {t("offers.posted", { time: posted })}
          </time>
        ) : null}
      </div>

      {children}
    </Card>
  );
}
