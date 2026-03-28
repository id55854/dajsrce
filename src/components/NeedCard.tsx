"use client";

import type { ComponentType } from "react";
import { Need } from "@/lib/types";
import type { InstitutionCategory } from "@/lib/types";
import { CATEGORY_CONFIG, DONATION_TYPES } from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";
import { hr } from "date-fns/locale/hr";
import * as Icons from "lucide-react";
import { PledgeButton } from "./PledgeButton";

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
};

const urgencyStyles = {
  urgent: { label: "Hitno", className: "bg-red-500 text-white" },
  needed_soon: {
    label: "Potrebno uskoro",
    className: "bg-orange-500 text-white",
  },
  routine: { label: "Standardno", className: "bg-gray-200 text-gray-700" },
} as const;

export function NeedCard({ need }: NeedCardProps) {
  const inst = need.institution;
  const cat = inst ? CATEGORY_CONFIG[inst.category] : null;
  const urgency = urgencyStyles[need.urgency];
  const needed = need.quantity_needed ?? 0;
  const pledged = need.quantity_pledged;
  const pct =
    needed > 0
      ? Math.min(100, Math.round((pledged / needed) * 100))
      : pledged > 0
        ? 100
        : 0;

  const posted = formatDistanceToNow(new Date(need.created_at), {
    addSuffix: true,
    locale: hr,
  });

  return (
    <article className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      {inst && cat ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-900">{inst.name}</span>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ backgroundColor: cat.bgColor, color: cat.color }}
          >
            {cat.labelHr}
          </span>
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${urgency.className}`}
        >
          {urgency.label}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-xs text-gray-600">
          <LucideByName
            name={DONATION_TYPES[need.donation_type].icon}
            className="h-3.5 w-3.5"
          />
          {DONATION_TYPES[need.donation_type].labelHr}
        </span>
      </div>

      <h2 className="text-lg font-semibold text-gray-900">{need.title}</h2>
      <p className="mt-2 text-gray-600 line-clamp-3">{need.description}</p>

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-gray-500">
          <span>
            {pledged} / {needed > 0 ? needed : "—"} zbrinuto
          </span>
          <span>{needed > 0 ? `${pct}%` : ""}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-red-500 transition-all"
            style={{ width: `${needed > 0 ? pct : pledged > 0 ? 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <PledgeButton needId={need.id} needTitle={need.title} />
        <time className="text-xs text-gray-400" dateTime={need.created_at}>
          {posted}
        </time>
      </div>
    </article>
  );
}
