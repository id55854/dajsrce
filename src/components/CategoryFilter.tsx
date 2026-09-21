"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import clsx from "clsx";
import { InstitutionCategory } from "@/lib/types";
import { CATEGORY_CONFIG, categoryVars } from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";

const CATEGORY_KEYS = Object.keys(CATEGORY_CONFIG) as InstitutionCategory[];

/**
 * The twelve categories, behind one button.
 *
 * They used to sit in the filter row itself, which meant twelve chips plus the
 * donation chips on one line that could only be reached by scrolling it
 * sideways: on a phone two thirds of the categories were off the edge with
 * nothing to say so, and on a desktop a horizontal scrollbar under a filter
 * bar reads as a layout accident rather than a control. A popover shows all
 * twelve at once, wrapped, and the trigger carries the count so the current
 * selection survives the collapse.
 *
 * Built to match `CityFilter`, deliberately: these two now sit side by side
 * and a visitor should not have to learn two different controls.
 */
export function CategoryFilter({
  value,
  onChange,
}: {
  value: InstitutionCategory[];
  onChange: (next: InstitutionCategory[]) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = (category: InstitutionCategory) => {
    onChange(
      value.includes(category)
        ? value.filter((entry) => entry !== category)
        : [...value, category]
    );
  };

  const count = value.length;
  const label = count > 0 ? t("filters.category_count", { count }) : t("filters.category_any");

  return (
    <div ref={containerRef} className="relative shrink-0">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={open ? panelId : undefined}
          className={clsx(
            "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border py-1.5 text-sm font-medium",
            "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out",
            "motion-safe:active:scale-[0.97]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            count > 0
              ? "border-brand bg-brand-soft text-brand-on-soft"
              : "cursor-pointer border-border-subtle bg-surface-raised text-ink-secondary hover:border-border-strong hover:bg-ink/[0.08] hover:text-ink",
            count > 0 ? "rounded-r-none border-r-0 pl-3.5 pr-2.5" : "px-3.5"
          )}
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden />
          <span className="max-w-[12rem] truncate">{label}</span>
        </button>
        {count > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            aria-label={t("filters.category_clear")}
            className={clsx(
              "inline-flex min-h-10 shrink-0 items-center rounded-full rounded-l-none border border-l-0 border-brand bg-brand-soft pl-1 pr-3 text-brand-on-soft",
              "transition-colors duration-150 ease-out hover:bg-brand-soft/70",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            )}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("filters.category")}
          // Wider than the city list because these are wrapped chips rather
          // than rows, and capped so the panel never outgrows a phone.
          className="absolute left-0 top-[calc(100%+0.375rem)] z-[var(--z-popover)] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-border-subtle bg-surface-overlay shadow-overlay"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
              {t("filters.category")}
            </span>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={count === 0}
              className="rounded-full px-2 py-1 text-xs font-semibold text-brand transition-colors hover:bg-brand-soft disabled:cursor-default disabled:text-ink-tertiary disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {t("filters.category_all")}
            </button>
          </div>

          <div className="flex max-h-[60dvh] flex-wrap gap-2 overflow-y-auto p-3">
            {CATEGORY_KEYS.map((category) => {
              const config = CATEGORY_CONFIG[category];
              const on = value.includes(category);
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(category)}
                  style={on ? categoryVars(category) : undefined}
                  className={clsx(
                    "inline-flex min-h-10 items-center justify-center rounded-full border px-3 py-1.5 text-sm font-medium",
                    "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out",
                    "motion-safe:active:scale-[0.97]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                    on
                      ? "category-chip border-current"
                      : "cursor-pointer border-border-subtle bg-surface-raised text-ink-secondary hover:border-border-strong hover:bg-ink/[0.08] hover:text-ink"
                  )}
                >
                  {locale === "hr" ? config.labelHr : config.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
