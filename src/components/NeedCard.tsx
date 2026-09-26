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
import { useLiveCapacity } from "@/lib/live-capacity";
import { CancelActionButton } from "@/components/YourPledgesSection";
import { DonationTypeIcon } from "@/components/DonationTypeIcon";
import { needAnchorId, needPermalink } from "@/lib/pledge-flow";
import { reportContentHref } from "@/lib/report-content";

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
  /**
   * The visitor's own standing pledges to this need. With
   * `onPledgesCancelled` the card offers to withdraw them.
   */
  myPledgeIds?: readonly string[];
  onPledgesCancelled?: (needId: string) => void;
  /** The need a link pointed at (`?need=` or a pledge resumed after sign-in). */
  highlighted?: boolean;
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
  myPledgeIds = [],
  onPledgesCancelled,
  highlighted = false,
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
  // Counts follow other donors live, and this donor's own pledge immediately
  // (the parent may or may not patch its list); see useLiveCapacity.
  const [counts, applyCounts] = useLiveCapacity("needs", need.id, {
    quantity_needed: need.quantity_needed,
    quantity_pledged: need.quantity_pledged,
    is_fulfilled: need.is_fulfilled,
  });
  const needed = counts.quantity_needed ?? 0;
  const pledged = counts.quantity_pledged;
  const pct =
    needed > 0
      ? Math.min(100, Math.round((pledged / needed) * 100))
      : pledged > 0
        ? 100
        : 0;
  const fulfilled = counts.is_fulfilled || (needed > 0 && pledged >= needed);
  const remaining = needed > 0 ? Math.max(0, needed - pledged) : null;

  const handlePledgeSuccess = (payload: PledgeSuccessPayload) => {
    if (payload.need) applyCounts({ quantity_pledged: payload.need.quantity_pledged });
    onPledgeSuccess?.(payload);
  };
  const mine = Boolean(myPledgedQty && myPledgedQty > 0);

  const posted = formatDistanceToNow(new Date(need.created_at), {
    addSuffix: true,
    locale: locale === "hr" ? hr : enUS,
  });
  // Rendered with the need's permalink so server and client agree; the click
  // swaps in the page the visitor is actually on.
  const reportHref = reportContentHref({ pageUrl: needPermalink(need.id), needId: need.id });

  return (
    <Card
      as="article"
      id={needAnchorId(need.id)}
      className={clsx(
        "flex h-full scroll-mt-24 flex-col transition-[opacity,filter] duration-300 ease-out",
        mine && "border-success ring-1 ring-success/30",
        highlighted && !mine && "border-brand ring-2 ring-brand/30",
        fulfilled && "opacity-60 grayscale"
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
        {mine && myPledgeIds.length > 0 && onPledgesCancelled ? (
          <CancelActionButton
            endpoint={myPledgeIds.map((id) => `/api/pledges/${id}`)}
            label={t("your_pledges.cancel")}
            title={t("your_pledges.cancel_title")}
            description={t("your_pledges.cancel_body", { title: need.title })}
            confirmLabel={t("your_pledges.cancel_confirm")}
            successTitle={t("your_pledges.cancel_success")}
            errorTitle={t("your_pledges.cancel_error")}
            conflictDescription={t("your_pledges.cancel_error_locked")}
            onCancelled={() => {
              applyCounts({
                quantity_pledged: Math.max(0, pledged - (myPledgedQty ?? 0)),
                is_fulfilled: false,
              });
              onPledgesCancelled(need.id);
            }}
          />
        ) : null}
        {canPledge ? (
          <PledgeButton
            needId={need.id}
            needTitle={need.title}
            institution={
              inst ? { id: inst.id, name: inst.name, address: inst.address, city: inst.city } : null
            }
            onPledgeSuccess={handlePledgeSuccess}
            remaining={remaining}
            full={fulfilled}
            onCapacityError={(code) => {
              // Nothing more fits; the next capacity poll brings the exact count.
              if (code === "need_fulfilled") applyCounts({ is_fulfilled: true });
            }}
          />
        ) : null}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-tertiary">
          <time dateTime={need.created_at}>{t("need_card.posted", { time: posted })}</time>
          {reportHref ? (
            <a
              href={reportHref}
              onClick={(event) => {
                const current = reportContentHref({ pageUrl: window.location.href, needId: need.id });
                if (current) event.currentTarget.href = current;
              }}
              className="rounded-control text-xs underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {t("need_card.report")}
            </a>
          ) : null}
        </span>
      </div>
    </Card>
  );
}
