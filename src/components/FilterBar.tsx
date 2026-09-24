"use client";

import type { ButtonHTMLAttributes } from "react";
import { InstitutionCategory, DonationType } from "@/lib/types";
import { categoryVars } from "@/lib/constants";
import clsx from "clsx";
import { useT } from "@/i18n/client";
import { CityFilter } from "@/components/CityFilter";
import { CategoryFilter } from "@/components/CategoryFilter";
import { SOCIAL_MAP_CATEGORIES } from "@/lib/location-map";

import { DonationFilter } from "@/components/DonationFilter";

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
  "cursor-pointer border-border-subtle bg-surface-raised text-ink-secondary hover:border-border-strong hover:bg-ink/[0.08] hover:text-ink";

const CHIP_ACTIVE = "border-brand bg-brand-soft text-brand-on-soft";

export type FilterChipProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-pressed"
> & {
  /**
   * Required, and the single source of both the pressed state and the visual
   * treatment; a chip can never look active without announcing it.
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
 *; and its two chip rows still disagreed with each other on weight and ink.
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
  /** Empty means "any kind of help"; several means "any one of these". */
  donationTypes: DonationType[];
  /**
   * Exact city name, or null for the whole country. Superseded `onlyZagreb`,
   * which could only ever answer for one of 3,401 places; that flag stays on
   * the query type so existing shared links keep working.
   */
  city: string | null;
  onlyZagreb: boolean;
  onlyUrgent: boolean;
  onlyOnboarded: boolean;
  onlySocial: boolean;
};

type FilterBarProps = {
  filters: FilterState;
  onChange: (next: FilterState) => void;
};

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const t = useT();
  return (
    <div className="w-full space-y-3">
      <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">{t("filters.onboarded_label")}</span>
          <span className="mt-0.5 block text-xs text-ink-secondary">{t("filters.onboarded_hint")}</span>
        </span>
        <span className="relative inline-flex shrink-0">
          <input type="checkbox" role="switch" checked={filters.onlyOnboarded} onChange={(event) => onChange({ ...filters, onlyOnboarded: event.target.checked })} className="peer sr-only" />
          <span aria-hidden className="h-6 w-11 rounded-full bg-ink/20 transition-colors peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface" />
          <span aria-hidden className="pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
        </span>
      </label>
      <CityFilter value={filters.city} onChange={(city) => onChange({ ...filters, city })} />
      <div className="flex flex-wrap gap-3">
        {/* The social view never offers the catch-all "Udruga": every unclassified
            register row is one, so picking it would reopen the whole register. */}
        <CategoryFilter
          value={filters.categories}
          onChange={(categories) => onChange({ ...filters, categories })}
          categories={filters.onlySocial ? SOCIAL_MAP_CATEGORIES : undefined}
        />
        <DonationFilter multiple value={filters.donationTypes} onChange={(donationTypes) => onChange({ ...filters, donationTypes })} />
      </div>
    </div>
  );
}
