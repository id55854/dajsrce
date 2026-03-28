"use client";

import { InstitutionCategory, DonationType } from "@/lib/types";
import { CATEGORY_CONFIG, DONATION_TYPES } from "@/lib/constants";
import clsx from "clsx";

const DONATION_TYPE_KEYS = Object.keys(DONATION_TYPES) as DonationType[];
const CATEGORY_KEYS = Object.keys(CATEGORY_CONFIG) as InstitutionCategory[];

export type FilterState = {
  categories: InstitutionCategory[];
  donationType: DonationType | null;
  onlyZagreb: boolean;
  onlyUrgent: boolean;
};

type FilterBarProps = {
  filters: FilterState;
  onChange: (next: FilterState) => void;
};

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const toggleCategory = (cat: InstitutionCategory) => {
    const has = filters.categories.includes(cat);
    const categories = has
      ? filters.categories.filter((c) => c !== cat)
      : [...filters.categories, cat];
    onChange({ ...filters, categories });
  };

  const setDonationType = (t: DonationType | null) => {
    onChange({ ...filters, donationType: t });
  };

  return (
    <div className="w-full">
      <div
        className={clsx(
          "flex flex-nowrap gap-2 overflow-x-auto pb-1",
          "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        )}
      >
        <div className="flex shrink-0 items-center gap-1.5 pr-2">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Kategorija
          </span>
        </div>
        {CATEGORY_KEYS.map((cat) => {
          const cfg = CATEGORY_CONFIG[cat];
          const on = filters.categories.includes(cat);
          return (
            <button
              key={cat}
              type="button"
              onClick={() => toggleCategory(cat)}
              className={clsx(
                "shrink-0 rounded-full border-2 px-3 py-1.5 text-xs font-medium transition-shadow",
                on ? "shadow-sm ring-2 ring-offset-1" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              )}
              style={
                on
                  ? {
                      borderColor: cfg.color,
                      backgroundColor: cfg.bgColor,
                      color: cfg.color,
                      boxShadow: `0 0 0 2px ${cfg.color}33`,
                    }
                  : undefined
              }
            >
              {cfg.labelHr}
            </button>
          );
        })}

        <div className="mx-1 h-8 w-px shrink-0 self-center bg-gray-200" aria-hidden />

        <div className="flex shrink-0 items-center gap-1.5 pr-2">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Donacija
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDonationType(null)}
          className={clsx(
            "shrink-0 rounded-full border-2 px-3 py-1.5 text-xs font-medium transition-colors",
            filters.donationType === null
              ? "border-red-500 bg-red-50 text-red-600"
              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
          )}
        >
          Sve
        </button>
        {DONATION_TYPE_KEYS.map((key) => {
          const on = filters.donationType === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setDonationType(on ? null : key)}
              className={clsx(
                "shrink-0 rounded-full border-2 px-3 py-1.5 text-xs font-medium transition-colors",
                on
                  ? "border-red-500 bg-red-50 text-red-600"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              )}
            >
              {DONATION_TYPES[key].labelHr}
            </button>
          );
        })}

        <div className="mx-1 h-8 w-px shrink-0 self-center bg-gray-200" aria-hidden />

        <button
          type="button"
          onClick={() => onChange({ ...filters, onlyZagreb: !filters.onlyZagreb })}
          className={clsx(
            "shrink-0 rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition-colors",
            filters.onlyZagreb
              ? "border-red-500 bg-red-50 text-red-600"
              : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
          )}
        >
          {filters.onlyZagreb ? "Samo Zagreb" : "Cijela Hrvatska"}
        </button>

        <button
          type="button"
          onClick={() => onChange({ ...filters, onlyUrgent: !filters.onlyUrgent })}
          className={clsx(
            "shrink-0 rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition-colors",
            filters.onlyUrgent
              ? "border-red-500 bg-red-50 text-red-600"
              : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
          )}
        >
          Samo hitne potrebe
        </button>
      </div>
    </div>
  );
}
