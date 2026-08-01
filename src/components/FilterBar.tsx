"use client";

import { InstitutionCategory, DonationType } from "@/lib/types";
import { CATEGORY_CONFIG, DONATION_TYPES } from "@/lib/constants";
import clsx from "clsx";
import { useLocale, useT } from "@/i18n/client";

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
  const t = useT();
  const { locale } = useLocale();
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
            {t("filters.category")}
          </span>
        </div>
        {CATEGORY_KEYS.map((cat) => {
          const cfg = CATEGORY_CONFIG[cat];
          const on = filters.categories.includes(cat);
          return (
            <button
              key={cat}
              type="button"
              aria-pressed={on}
              onClick={() => toggleCategory(cat)}
              className={clsx(
                "shrink-0 rounded-full border-2 px-3 py-1.5 text-xs font-medium transition-shadow",
                on
                  ? "shadow-sm ring-2 ring-offset-1"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-600"
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
              {locale === "hr" ? cfg.labelHr : cfg.label}
            </button>
          );
        })}

        <div
          className="mx-1 h-8 w-px shrink-0 self-center bg-gray-200 dark:bg-gray-700"
          aria-hidden
        />

        <div className="flex shrink-0 items-center gap-1.5 pr-2">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t("filters.donation")}
          </span>
        </div>
        <button
          type="button"
          aria-pressed={filters.donationType === null}
          onClick={() => setDonationType(null)}
          className={clsx(
            "shrink-0 rounded-full border-2 px-3 py-1.5 text-xs font-medium transition-colors",
            filters.donationType === null
              ? "border-red-500 bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-600"
          )}
        >
          {t("filters.all")}
        </button>
        {DONATION_TYPE_KEYS.map((key) => {
          const on = filters.donationType === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => setDonationType(on ? null : key)}
              className={clsx(
                "shrink-0 rounded-full border-2 px-3 py-1.5 text-xs font-medium transition-colors",
                on
                  ? "border-red-500 bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-600"
              )}
            >
              {locale === "hr"
                ? DONATION_TYPES[key].labelHr
                : DONATION_TYPES[key].label}
            </button>
          );
        })}

        <div
          className="mx-1 h-8 w-px shrink-0 self-center bg-gray-200 dark:bg-gray-700"
          aria-hidden
        />

        <button
          type="button"
          aria-pressed={filters.onlyZagreb}
          onClick={() => onChange({ ...filters, onlyZagreb: !filters.onlyZagreb })}
          className={clsx(
            "shrink-0 rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition-colors",
            filters.onlyZagreb
              ? "border-red-500 bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
              : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-600"
          )}
        >
          {filters.onlyZagreb
            ? t("filters.zagreb_only")
            : t("filters.all_croatia")}
        </button>

        <button
          type="button"
          aria-pressed={filters.onlyUrgent}
          onClick={() => onChange({ ...filters, onlyUrgent: !filters.onlyUrgent })}
          className={clsx(
            "shrink-0 rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition-colors",
            filters.onlyUrgent
              ? "border-red-500 bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
              : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-600"
          )}
        >
          {t("filters.urgent_only")}
        </button>
      </div>
    </div>
  );
}
