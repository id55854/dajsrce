"use client";

import type { ComponentType } from "react";
import { CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { Need } from "@/lib/types";
import type { InstitutionCategory } from "@/lib/types";
import { DONATION_TYPES, getCategoryConfig } from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";
import * as Icons from "lucide-react";
import { useT } from "@/i18n/client";
import { PledgeButton, type PledgeSuccessPayload } from "./PledgeButton";

function LucideByName({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, ComponentType<{ className?: string }>>)[
    name
  ];
  if (!Cmp) return null;
  return <Cmp className={className} />;
}

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
};

const urgencyStyles = {
  urgent: { label: "Urgent", className: "bg-red-500 text-white" },
  needed_soon: {
    label: "Needed soon",
    className: "bg-orange-500 text-white",
  },
  routine: {
    label: "Routine",
    className: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  },
} as const;

export function NeedCard({ need, myPledgedQty = null, onPledgeSuccess }: NeedCardProps) {
  const t = useT();
  const inst = need.institution;
  const cat = inst ? getCategoryConfig(inst.category) : null;
  const urgency = urgencyStyles[need.urgency];
  const needed = need.quantity_needed ?? 0;
  const pledged = need.quantity_pledged;
  const pct =
    needed > 0
      ? Math.min(100, Math.round((pledged / needed) * 100))
      : pledged > 0
        ? 100
        : 0;
  const fulfilled = needed > 0 && pct >= 100;

  const posted = formatDistanceToNow(new Date(need.created_at), {
    addSuffix: true,
  });

  return (
    <article
      className={clsx(
        "rounded-xl border bg-white p-5 shadow-sm transition-colors dark:bg-gray-900",
        myPledgedQty && myPledgedQty > 0
          ? "border-emerald-300 ring-1 ring-emerald-200/70 dark:border-emerald-800 dark:ring-emerald-900/40"
          : "border-gray-100 dark:border-gray-800"
      )}
    >
      {inst && cat ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {inst.name}
          </span>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ backgroundColor: cat.bgColor, color: cat.color }}
          >
            {cat.label}
          </span>
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        {fulfilled ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-xs font-semibold text-white">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            100%
          </span>
        ) : (
          <span
            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${urgency.className}`}
          >
            {urgency.label}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          <LucideByName
            name={DONATION_TYPES[need.donation_type].icon}
            className="h-3.5 w-3.5"
          />
          {DONATION_TYPES[need.donation_type].label}
        </span>
        {myPledgedQty && myPledgedQty > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {t("your_pledges.you_pledged").replace("{qty}", String(myPledgedQty))}
          </span>
        ) : null}
      </div>

      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {need.title}
      </h2>
      <p className="mt-2 text-gray-600 line-clamp-3 dark:text-gray-400">
        {need.description}
      </p>

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>
            {pledged} / {needed > 0 ? needed : "—"} pledged
          </span>
          <span>{needed > 0 ? `${pct}%` : ""}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div
            className="h-full rounded-full bg-red-500 transition-all"
            style={{ width: `${needed > 0 ? pct : pledged > 0 ? 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <PledgeButton
          needId={need.id}
          needTitle={need.title}
          onPledgeSuccess={onPledgeSuccess}
        />
        <time className="text-xs text-gray-400" dateTime={need.created_at}>
          {posted}
        </time>
      </div>
    </article>
  );
}
