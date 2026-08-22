"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Loader2, LocateFixed, Map as MapIcon, Search } from "lucide-react";
import clsx from "clsx";
import { Button, Dialog } from "@/components/ui";
import { useLocale, useT } from "@/i18n/client";
import {
  MAP_CITY_QUERY_MAX_LENGTH,
  type PublicMapCitiesResponse,
  type PublicMapCity,
} from "@/lib/location-map";

/**
 * Both dialogs live here, behind a dynamic import from the map page: neither
 * is needed to draw the map, so neither belongs in its initial chunk. The
 * preference hook that decides whether to show them is in `use-map-start`.
 */

/**
 * The first thing a visitor sees on the map.
 *
 * The map opens on the whole country, which is 43,000+ organisations rendered
 * as a wall of bubbles — true, but useless as a starting point. This asks
 * where to begin instead of guessing, and it is a card with buttons rather
 * than an automatic geolocation call: the browser's own permission prompt only
 * appears after the visitor has asked for it, which is both the project's rule
 * and the only version of this that does not feel like an ambush.
 */
export function LocationStartDialog({
  open,
  onUseLocation,
  onChooseCity,
  onShowCountry,
}: {
  open: boolean;
  onUseLocation: () => void;
  onChooseCity: () => void;
  onShowCountry: () => void;
}) {
  const t = useT();

  return (
    <Dialog
      open={open}
      onClose={onShowCountry}
      title={t("map_start.title")}
      description={t("map_start.description")}
      closeLabel={t("map_start.dismiss")}
      variant="sheet-on-mobile"
    >
      <div className="flex flex-col gap-3">
        <Button
          size="lg"
          fullWidth
          data-dialog-initial-focus
          icon={<LocateFixed className="h-5 w-5" aria-hidden />}
          onClick={onUseLocation}
        >
          {t("map_start.use_location")}
        </Button>
        <Button
          size="lg"
          fullWidth
          variant="secondary"
          icon={<Building2 className="h-5 w-5" aria-hidden />}
          onClick={onChooseCity}
        >
          {t("map_start.choose_city")}
        </Button>
        <Button
          fullWidth
          variant="ghost"
          icon={<MapIcon className="h-4 w-4" aria-hidden />}
          onClick={onShowCountry}
        >
          {t("map_start.show_country")}
        </Button>
      </div>

      <p className="mt-4 text-xs leading-5 text-ink-tertiary">
        {t("map_start.privacy_note")}
      </p>
    </Dialog>
  );
}

/**
 * The alternative to sharing a location: pick a city and fly there.
 *
 * The list is the published register aggregated by city, ordered by how many
 * organisations sit in each, so the useful choices are at the top before a
 * single character is typed.
 */
export function CityPickerDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (city: PublicMapCity) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [query, setQuery] = useState("");
  const [cities, setCities] = useState<PublicMapCity[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setFailed(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        setFailed(false);
        const params = new URLSearchParams();
        const trimmed = query.trim();
        if (trimmed) params.set("q", trimmed.slice(0, MAP_CITY_QUERY_MAX_LENGTH));
        fetch(`/api/v1/map/cities?${params.toString()}`, { signal: controller.signal })
          .then((response) => {
            if (!response.ok) throw new Error("cities_unavailable");
            return response.json() as Promise<PublicMapCitiesResponse>;
          })
          .then((result) => {
            if (!controller.signal.aborted) setCities(result.cities);
          })
          .catch(() => {
            if (!controller.signal.aborted) setFailed(true);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      // The unfiltered first page is worth showing immediately; only typing
      // is debounced.
      query.trim() ? 220 : 0
    );

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("map_start.city_title")}
      description={t("map_start.city_description")}
      closeLabel={t("common.close")}
      variant="sheet-on-mobile"
    >
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-ink-tertiary" aria-hidden />
        <input
          ref={inputRef}
          data-dialog-initial-focus
          type="text"
          value={query}
          maxLength={MAP_CITY_QUERY_MAX_LENGTH}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("map_start.city_placeholder")}
          aria-label={t("map_start.city_placeholder")}
          className="h-11 w-full cursor-pointer rounded-full border border-border-subtle bg-surface-raised pl-10 pr-4 text-sm text-ink outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-out placeholder:text-ink-tertiary hover:bg-ink/[0.08] focus-visible:border-brand focus-visible:bg-surface-raised focus-visible:ring-2 focus-visible:ring-brand"
        />
      </div>

      <div className="mt-3 max-h-[45dvh] overflow-y-auto overscroll-contain rounded-control border border-border-subtle">
        {failed ? (
          <p role="alert" className="px-4 py-6 text-center text-sm text-ink-secondary">
            {t("map_start.city_error")}
          </p>
        ) : loading && cities.length === 0 ? (
          <p role="status" className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-ink-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("map_start.city_loading")}
          </p>
        ) : cities.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-secondary">
            {t("map_start.city_empty")}
          </p>
        ) : (
          <ul role="list" className={clsx("divide-y divide-border-subtle", loading && "opacity-60")}>
            {cities.map((city) => (
              <li key={`${city.county}:${city.city}`}>
                <button
                  type="button"
                  onClick={() => onSelect(city)}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand motion-safe:active:scale-[0.99]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{city.city}</span>
                    <span className="block truncate text-xs text-ink-secondary">{city.county}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-tertiary">
                    {city.organisationCount.toLocaleString(locale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
