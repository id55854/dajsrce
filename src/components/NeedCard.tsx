"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { Need } from "@/lib/types";
import type { InstitutionCategory } from "@/lib/types";
import {
  CATEGORY_CONFIG,
  DONATION_TYPES,
  categoryVars,
  getCategoryConfig,
} from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";
import { enUS, hr } from "date-fns/locale";
import { useLocale, useT } from "@/i18n/client";
import { Badge, Card, type BadgeTone } from "@/components/ui";
import { PledgeButton, type PledgeSuccessPayload } from "./PledgeButton";
import { DonationTypeIcon } from "@/components/DonationTypeIcon";

export type NeedCardNeed = Need & {
  institution?: {
    id: string;
    name: string;
    category: InstitutionCategory;
    address: string;
    city: string;
  };
};

type NeedCardProps = {
  need: NeedCardNeed;
  /** Total quantity the signed-in user has already pledged to this need. */
  myPledgedQty?: number | null;
  /** Bubbles up after a successful pledge so the parent can patch state. */
  onPledgeSuccess?: (payload: PledgeSuccessPayload) => void;
  /**
   * False for an NGO account: giving is a citizen action, so an NGO never
   * pledges against a need; its own included. `/api/pledges` rejects the
   * request either way; hiding the button keeps the account from walking into
   * a 403. The parent resolves the role once, rather than every card asking.
   */
  canPledge?: boolean;
};

/** One status→tone map, so urgency reads the same wherever a need appears. */
const URGENCY: Record<Need["urgency"], { key: string; tone: BadgeTone }> = {
  urgent: { key: "need_card.urgent", tone: "danger" },
  needed_soon: { key: "need_card.needed_soon", tone: "warning" },
  routine: { key: "need_card.routine", tone: "neutral" },
};

export function NeedCard({
  need,
  myPledgedQty = null,
  onPledgeSuccess,
  canPledge = true,
}: NeedCardProps) {
  const t = useT();
  const { locale } = useLocale();
  const inst = need.institution;
  const cat = inst ? getCategoryConfig(inst.category) : null;
  // `.category-chip` defaults `--cat` to the brand hue, so an unrecognised
  // category (a row newer than this deploy) degrades instead of crashing.
  const catStyle =
    inst && inst.category in CATEGORY_CONFIG
      ? categoryVars(inst.category)
      : undefined;
  const urgency = URGENCY[need.urgency];
  const needed = need.quantity_needed ?? 0;
  const pledged = need.quantity_pledged;
  const pct =
    needed > 0
      ? Math.min(100, Math.round((pledged / needed) * 100))
      : pledged > 0
        ? 100
        : 0;
  const fulfilled = needed > 0 && pct >= 100;
  const mine = Boolean(myPledgedQty && myPledgedQty > 0);

  const posted = formatDistanceToNow(new Date(need.created_at), {
    addSuffix: true,
    locale: locale === "hr" ? hr : enUS,
  });

  return (
    <Card
      as="article"
      className={clsx(
        "flex h-full flex-col",
        mine && "border-success ring-1 ring-success/30"
      )}
    >
      {inst ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* The id was already in props; the name used to be a dead <span>. */}
          <Link
            href={`/institution/${inst.id}`}
            className="rounded-control text-sm font-semibold text-ink underline-offset-2 transition-colors hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {inst.name}
          </Link>
          {cat ? (
            <span
              style={catStyle}
              className="category-chip inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold"
            >
              {locale === "hr" ? cat.labelHr : cat.label}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        {fulfilled ? (
          <Badge
            tone="success"
            icon={<CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
          >
            100%
          </Badge>
        ) : (
          <Badge tone={urgency.tone}>{t(urgency.key)}</Badge>
        )}
        <Badge
          icon={
            <DonationTypeIcon
              type={need.donation_type}
              className="h-3.5 w-3.5"
            />
          }
        >
          {locale === "hr"
            ? DONATION_TYPES[need.donation_type].labelHr
            : DONATION_TYPES[need.donation_type].label}
        </Badge>
        {mine ? (
          <Badge
            tone="success"
            icon={<CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
          >
            {t("your_pledges.you_pledged").replace("{qty}", String(myPledgedQty))}
          </Badge>
        ) : null}
      </div>

      <h2 className="line-clamp-2 text-lg font-semibold leading-snug text-ink">
        {need.title}
      </h2>
      <p className="mt-2 line-clamp-3 text-base leading-6 text-ink-secondary">
        {need.description}
      </p>

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-sm text-ink-tertiary">
          <span>
            {t("need_card.pledged", {
              pledged,
              needed: needed > 0 ? needed : "—",
            })}
          </span>
          <span>{needed > 0 ? `${pct}%` : ""}</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={t("need_card.progress", { percent: pct })}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
            style={{ width: `${needed > 0 ? pct : pledged > 0 ? 100 : 0}%` }}
          />
        </div>
      </div>

      <div
        className={clsx(
          "mt-auto flex flex-wrap items-center gap-3 pt-4",
          canPledge ? "justify-between" : "justify-end"
        )}
      >
        {canPledge ? (
          <PledgeButton
            needId={need.id}
            needTitle={need.title}
            onPledgeSuccess={onPledgeSuccess}
          />
        ) : null}
        <time className="text-sm text-ink-tertiary" dateTime={need.created_at}>
          {t("need_card.posted", { time: posted })}
        </time>
      </div>
    </Card>
  );
}
