"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import clsx from "clsx";
import { useT } from "@/i18n/client";
import type { PublicMapCity } from "@/lib/location-map";

/**
 * Picks one city from the register's own list of 3,401.
 *
 * A free-text box would be the smaller change but the wrong one: the map
 * filters on an exact city name, so anything the visitor types that is not
 * spelled exactly as the register spells it returns an empty map with no
 * explanation. Choosing from the list makes an empty result impossible for
 * spelling reasons, and the counts alongside each name tell the visitor what
 * they are about to get before they commit to it.
 *
 * The list comes from `/api/v1/map/cities`, which is an aggregate over the
 * published snapshot and is cached hard at the edge - it never exposes
 * row-level data.
 */
export function CityFilter({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (city: string | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [cities, setCities] = useState<PublicMapCity[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Debounced so typing does not fire a request per keystroke, and aborted on
  // change so a slow early response cannot overwrite a newer one.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ limit: "40" });
      if (term.trim()) params.set("q", term.trim());
      fetch(`/api/v1/map/cities?${params.toString()}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error("cities_unavailable");
          return response.json();
        })
        .then((result: { cities: PublicMapCity[] }) => {
          if (!controller.signal.aborted) setCities(result.cities);
        })
        .catch(() => {
          if (!controller.signal.aborted) setCities([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [term, open]);

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

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setTerm("");
  }, [open]);

  const label = useMemo(
    () => value ?? t("filters.city_any"),
    [value, t]
  );

  return (
    <div ref={containerRef} className="relative shrink-0">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          className={clsx(
            "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border py-1.5 text-sm font-medium",
            "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out",
            "motion-safe:active:scale-[0.97]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            value
              ? "border-brand bg-brand-soft text-brand-on-soft"
              : "cursor-pointer border-border-subtle bg-surface-raised text-ink-secondary hover:border-border-strong hover:bg-ink/[0.08] hover:text-ink",
            value ? "rounded-r-none border-r-0 pl-3.5 pr-2.5" : "px-3.5"
          )}
        >
          <MapPin className="h-4 w-4 shrink-0" aria-hidden />
          <span className="max-w-[10rem] truncate">{label}</span>
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("filters.city_clear")}
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
        <div className="absolute left-0 top-[calc(100%+0.375rem)] z-[var(--z-popover)] w-72 overflow-hidden rounded-card border border-border-subtle bg-surface-overlay shadow-overlay">
          <div className="border-b border-border-subtle p-2">
            <input
              ref={inputRef}
              type="text"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={t("filters.city_search")}
              aria-label={t("filters.city_search")}
              maxLength={80}
              className="w-full cursor-pointer rounded-input border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 ease-out placeholder:text-ink-tertiary hover:bg-ink/[0.08] focus:border-brand focus:bg-surface-raised"
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {loading && cities.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-tertiary">
                {t("common.loading")}
              </li>
            ) : cities.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-tertiary">
                {t("filters.city_none")}
              </li>
            ) : (
              cities.map((city) => (
                <li key={`${city.county}/${city.city}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={city.city === value}
                    onClick={() => {
                      onChange(city.city);
                      setOpen(false);
                    }}
                    className={clsx(
                      "flex w-full cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-left text-sm",
                      "transition-colors duration-100 hover:bg-ink/[0.08]",
                      city.city === value ? "text-brand" : "text-ink"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{city.city}</span>
                      <span className="block truncate text-xs text-ink-tertiary">
                        {city.county}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-tertiary">
                      {city.organisationCount.toLocaleString("hr-HR")}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
