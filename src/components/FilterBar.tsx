"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { InstitutionCategory, DonationType } from "@/lib/types";
import { CATEGORY_CONFIG, DONATION_TYPES, categoryVars } from "@/lib/constants";
import clsx from "clsx";
import { useLocale, useT } from "@/i18n/client";

const DONATION_TYPE_KEYS = Object.keys(DONATION_TYPES) as DonationType[];
const CATEGORY_KEYS = Object.keys(CATEGORY_CONFIG) as InstitutionCategory[];

/**
 * One transition declaration per chip: stacking `transition-colors` with
 * `transition-shadow`/`transition-transform` lets whichever utility Tailwind
 * emits last win, which is why the coloured category chips used to snap while
 * their siblings faded.
 *
 * `min-h-10` raises the target from the old 32px toward the comfortable
 * minimum without making a scrolling chip row feel like a toolbar.
 */
const CHIP_BASE = [
  "inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border px-3.5 py-1.5 text-sm font-medium",
  "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out",
  "motion-safe:active:scale-[0.97]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
].join(" ");

const CHIP_INACTIVE =
  "border-border-subtle bg-surface-raised text-ink-secondary hover:border-border-strong hover:text-ink";

const CHIP_ACTIVE = "border-brand bg-brand-soft text-brand-on-soft";

export type FilterChipProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-pressed"
> & {
  /**
   * Required, and the single source of both the pressed state and the visual
   * treatment — a chip can never look active without announcing it.
   */
  "aria-pressed": boolean;
  /**
   * Tints the active chip with the category hue instead of the brand. The hue
   * is published as `--cat` and mixed against the theme's surface/ink tokens by
   * `.category-chip`, so it stays readable in dark mode (applying the raw
   * light-mode tint is what made these chips near-white on dark cards).
   */
  category?: InstitutionCategory;
};

/**
 * The one filter chip. `/needs` used to re-implement this markup byte for byte
 * — and its two chip rows still disagreed with each other on weight and ink.
 */
export function FilterChip({
  "aria-pressed": pressed,
  category,
  className,
  style,
  ...rest
}: FilterChipProps) {
  const tinted = pressed && category;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      style={tinted ? { ...categoryVars(category), ...style } : style}
      className={clsx(
        CHIP_BASE,
        pressed
          ? tinted
            ? "category-chip border-current"
            : CHIP_ACTIVE
          : CHIP_INACTIVE,
        className
      )}
      {...rest}
    />
  );
}

export type FilterState = {
  categories: InstitutionCategory[];
  donationType: DonationType | null;
  onlyZagreb: boolean;
  onlyUrgent: boolean;
  onlyOnboarded: boolean;
  onlySocial: boolean;
};

type FilterBarProps = {
  filters: FilterState;
  onChange: (next: FilterState) => void;
};

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 pr-2">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
        {children}
      </span>
    </div>
  );
}

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
        <GroupLabel>{t("filters.category")}</GroupLabel>
        {CATEGORY_KEYS.map((cat) => {
          const cfg = CATEGORY_CONFIG[cat];
          const on = filters.categories.includes(cat);
          return (
            <FilterChip
              key={cat}
              aria-pressed={on}
              category={cat}
              onClick={() => toggleCategory(cat)}
            >
              {locale === "hr" ? cfg.labelHr : cfg.label}
            </FilterChip>
          );
        })}

        <div
          className="mx-1 h-8 w-px shrink-0 self-center bg-border-subtle"
          aria-hidden
        />

        <GroupLabel>{t("filters.donation")}</GroupLabel>
        <FilterChip
          aria-pressed={filters.donationType === null}
          onClick={() => setDonationType(null)}
        >
          {t("filters.all")}
        </FilterChip>
        {DONATION_TYPE_KEYS.map((key) => {
          const on = filters.donationType === key;
          return (
            <FilterChip
              key={key}
              aria-pressed={on}
              onClick={() => setDonationType(on ? null : key)}
            >
              {locale === "hr"
                ? DONATION_TYPES[key].labelHr
                : DONATION_TYPES[key].label}
            </FilterChip>
          );
        })}

        <div
          className="mx-1 h-8 w-px shrink-0 self-center bg-border-subtle"
          aria-hidden
        />

        <FilterChip
          aria-pressed={filters.onlyZagreb}
          onClick={() => onChange({ ...filters, onlyZagreb: !filters.onlyZagreb })}
        >
          {filters.onlyZagreb
            ? t("filters.zagreb_only")
            : t("filters.all_croatia")}
        </FilterChip>

        <FilterChip
          aria-pressed={filters.onlyUrgent}
          onClick={() => onChange({ ...filters, onlyUrgent: !filters.onlyUrgent })}
        >
          {t("filters.urgent_only")}
        </FilterChip>

        {/* Most of the register is sports, culture and hobby associations that
            nobody comes here to find. This chip is on by default; turning it
            off widens the map to every registered association, including the
            ones the classifier could not place. */}
        <FilterChip
          aria-pressed={filters.onlySocial}
          onClick={() => onChange({ ...filters, onlySocial: !filters.onlySocial })}
        >
          {filters.onlySocial ? t("filters.social_only") : t("filters.all_associations")}
        </FilterChip>

        <FilterChip
          aria-pressed={filters.onlyOnboarded}
          onClick={() => onChange({ ...filters, onlyOnboarded: !filters.onlyOnboarded })}
        >
          {t("filters.onboarded_only")}
        </FilterChip>
      </div>
    </div>
  );
}
