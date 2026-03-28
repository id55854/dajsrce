"use client";

import type { ComponentType } from "react";
import { Institution } from "@/lib/types";
import { CATEGORY_CONFIG, DONATION_TYPES } from "@/lib/constants";
import { BadgeCheck } from "lucide-react";
import * as Icons from "lucide-react";
import clsx from "clsx";

function LucideByName({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Cmp = (Icons as unknown as Record<string, ComponentType<{ className?: string }>>)[
    name
  ];
  if (!Cmp) return null;
  return <Cmp className={className} />;
}

type InstitutionCardProps = {
  institution: Institution;
  isSelected: boolean;
  onClick: () => void;
};

export function InstitutionCard({
  institution,
  isSelected,
  onClick,
}: InstitutionCardProps) {
  const cat = CATEGORY_CONFIG[institution.category];

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "w-full rounded-xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-all hover:shadow-md",
        isSelected && "ring-2 ring-red-500 ring-offset-2"
      )}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <span
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: cat.bgColor, color: cat.color }}
        >
          {cat.label}
        </span>
        <div className="flex items-center gap-1">
          {institution.is_verified ? (
            <span className="inline-flex items-center gap-0.5 text-emerald-600" title="Verified">
              <BadgeCheck className="h-5 w-5 shrink-0" strokeWidth={2} />
            </span>
          ) : null}
        </div>
      </div>

      <h3 className="font-semibold text-gray-900">{institution.name}</h3>
      <p className="mt-1 text-sm text-gray-500 line-clamp-2">
        {institution.address}
        {institution.city ? `, ${institution.city}` : ""}
      </p>

      {institution.is_location_hidden ? (
        <span className="mt-2 inline-block rounded-full bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-700">
          Hidden location
        </span>
      ) : null}

      {institution.accepts_donations.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {institution.accepts_donations.map((dt) => (
            <span
              key={dt}
              className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600"
            >
              <LucideByName
                name={DONATION_TYPES[dt].icon}
                className="h-3.5 w-3.5 text-gray-500"
              />
              {DONATION_TYPES[dt].label}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  );
}
