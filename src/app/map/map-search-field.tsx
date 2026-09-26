"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import clsx from "clsx";
import { Loader2, Search, X } from "lucide-react";
import { Menu, SEARCH_CONTROL_CLASSES } from "@/components/ui";
import { useLocale, useT } from "@/i18n/client";
import { pluralKey } from "@/i18n/dictionaries";
import { getCategoryConfig } from "@/lib/constants";
import type { PublicMapCluster, PublicMapInstitution } from "@/lib/location-map";

/**
 * The map search combobox. Two instances exist, floating over the tiles on
 * desktop, in the sheet header on phones; so each owns its own open state and
 * its own ids, while the query and the candidate set stay with the page.
 *
 * Roving selection is the part that was missing: the ARIA wiring was complete
 * but there was no `aria-activedescendant` and no arrow keys, so the listbox
 * could only be reached by tabbing through every option.
 */
export function MapSearchField({
  idPrefix,
  tone,
  className,
  value,
  onValueChange,
  onClear,
  hits,
  places = [],
  totalMatches = 0,
  pending,
  onSelect,
  onSelectPlace,
  onOpen,
}: {
  idPrefix: string;
  tone: "floating" | "inline";
  className?: string;
  value: string;
  onValueChange: (next: string) => void;
  onClear: () => void;
  hits: PublicMapInstitution[];
  /**
   * The places a broad search is grouped into when it matches more pins than
   * the map can draw one by one. Offered instead of pins, so the list never
   * says "no results" beside a panel counting a thousand of them.
   */
  places?: PublicMapCluster[];
  /** How many organisations the grouped places hold together. */
  totalMatches?: number;
  /** A request is in flight, or the debounce has not settled yet. */
  pending: boolean;
  onSelect: (id: string) => void;
  onSelectPlace?: (place: PublicMapCluster) => void;
  /** Fired when the field takes focus, so a host can make room for the list. */
  onOpen?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = `${idPrefix}-listbox`;
  const optionId = (index: number) => `${idPrefix}-option-${index}`;
  const trimmed = value.trim();
  const expanded = open && trimmed.length > 0;
  // Pins when the search resolves into them; otherwise the places it is
  // grouped into. Never both: the map shows one or the other.
  const showingPlaces = hits.length === 0 && places.length > 0;
  const optionCount = showingPlaces ? places.length : hits.length;

  // A new candidate set invalidates the cursor.
  useEffect(() => {
    setActiveIndex(-1);
  }, [hits, places]);

  const closeList = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  function commit(index: number) {
    if (showingPlaces) {
      const place = places[index];
      if (!place) return;
      onSelectPlace?.(place);
      closeList();
      return;
    }
    const hit = hits[index];
    if (!hit) return;
    onSelect(hit.id);
    closeList();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      closeList();
      return;
    }
    if (optionCount === 0) {
      if (event.key === "ArrowDown") setOpen(true);
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        setActiveIndex((current) => (current + 1) % optionCount);
        break;
      case "ArrowUp":
        event.preventDefault();
        setOpen(true);
        setActiveIndex((current) => (current <= 0 ? optionCount - 1 : current - 1));
        break;
      case "Home":
        if (expanded) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (expanded) {
          event.preventDefault();
          setActiveIndex(optionCount - 1);
        }
        break;
      case "Enter":
        if (expanded && activeIndex >= 0) {
          event.preventDefault();
          commit(activeIndex);
        }
        break;
      default:
        break;
    }
  }

  const status = pending
    ? null
    : trimmed.length < 2
      ? t("map_page.type_more")
      : optionCount === 0
        ? t("map_page.no_matches")
        : null;
  const optionClasses = (active: boolean) =>
    clsx(
      "flex w-full cursor-pointer items-start gap-3 px-3 py-3 text-left transition-colors",
      active ? "bg-ink/[0.08]" : "hover:bg-ink/[0.08]"
    );

  return (
    // The caller positions the outer box; the inner one is the popover's
    // containing block. Keeping them separate means a caller's `absolute` can
    // never race this component's own `relative` in the cascade.
    <div className={className}>
      <div className="relative">
        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-3 h-4 w-4 text-ink-tertiary"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(event) => {
              onValueChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
              onOpen?.();
            }}
            onKeyDown={onKeyDown}
            placeholder={t("map_page.search_placeholder")}
            data-ui-material={tone === "floating" ? "" : undefined}
            className={clsx(
              // A soft filled rounded rectangle rather than a bordered pill:
              // the fill carries the shape, and the border only appears as the
              // brand focus ring.
              "h-12 w-full rounded-card border border-transparent pl-10 pr-12 text-base text-ink outline-none md:text-sm",
              "transition-[background-color,border-color,box-shadow] duration-150 ease-out",
              SEARCH_CONTROL_CLASSES,
              "placeholder:text-ink-tertiary focus-visible:border-brand focus-visible:bg-surface-raised focus-visible:ring-2 focus-visible:ring-brand",
              // WebKit and Blink draw their own clear affordance inside
              // `type=search`. It sat directly beside this component's own X
              // two identical buttons, one of them unstyled, undersized and
              // invisible to the clear handler. The input's search semantics
              // are worth keeping; the duplicate control is not.
              "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
              tone === "floating"
                ? "bg-chrome shadow-overlay backdrop-blur-xl"
                : "bg-surface-sunken focus-visible:bg-surface-raised"
            )}
            aria-label={t("map_page.search_aria")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listboxId}
            aria-activedescendant={
              expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined
            }
          />
          {value ? (
            <button
              type="button"
              onClick={() => {
                onClear();
                closeList();
                inputRef.current?.focus({ preventScroll: true });
              }}
              aria-label={t("map_page.clear_search")}
              className="absolute right-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <Menu
          open={expanded}
          onClose={closeList}
          align="top-left"
          returnFocusRef={inputRef}
          role="region"
          aria-label={t("map_page.search_aria")}
          className="left-0 right-0"
        >
          <ul
            id={listboxId}
            role="listbox"
            aria-label={t("map_page.search_aria")}
            className="max-h-[60dvh] touch-pan-y divide-y divide-border-subtle overflow-y-auto overscroll-contain"
          >
            {pending ? (
              <li
                role="presentation"
                className="flex items-center justify-center gap-2 px-4 py-4 text-sm text-ink-secondary"
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("map_page.searching")}
              </li>
            ) : status ? (
              <li
                role="presentation"
                className="px-4 py-5 text-center text-sm text-ink-secondary"
              >
                {status}
              </li>
            ) : showingPlaces ? (
              <>
                <li
                  role="presentation"
                  className="px-4 py-3 text-xs leading-relaxed text-ink-secondary"
                >
                  {t(pluralKey("map_page.search_grouped", locale, totalMatches), {
                    count: totalMatches.toLocaleString(locale),
                  })}
                </li>
                {places.map((place, index) => {
                  const active = index === activeIndex;
                  const count = place.count.toLocaleString(locale);
                  return (
                    <li key={place.id} role="none">
                      <button
                        type="button"
                        role="option"
                        id={optionId(index)}
                        aria-selected={active}
                        tabIndex={-1}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => commit(index)}
                        className={optionClasses(active)}
                      >
                        <span
                          className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-brand"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">
                            {place.placeName ??
                              t(pluralKey("map_ui.cluster_alt", locale, place.count), { count })}
                          </span>
                          <span className="block truncate text-xs text-ink-secondary">
                            {place.placeName ? `${t(`map_ui.place_kind_${place.placeKind}`)} • ` : ""}
                            {t(pluralKey("map_ui.cluster_count", locale, place.count), { count })}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </>
            ) : (
              hits.map((institution, index) => {
                const category = getCategoryConfig(institution.category);
                const active = index === activeIndex;
                return (
                  <li key={institution.id} role="none">
                    <button
                      type="button"
                      role="option"
                      id={optionId(index)}
                      aria-selected={active}
                      tabIndex={-1}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => commit(index)}
                      className={optionClasses(active)}
                    >
                      <span
                        className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: category.color }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {institution.name}
                        </span>
                        <span className="block truncate text-xs text-ink-secondary">
                          {locale === "hr" ? category.labelHr : category.label}
                          {institution.city ? ` • ${institution.city}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </Menu>
      </div>
    </div>
  );
}
