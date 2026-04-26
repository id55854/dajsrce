"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  List,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  Search,
  X,
} from "lucide-react";
import type { Institution } from "@/lib/types";
import type { MapFilters } from "@/components/Map";
import { FilterBar } from "@/components/FilterBar";
import { InstitutionCard } from "@/components/InstitutionCard";
import { InstitutionDetailPanel } from "@/components/InstitutionDetailPanel";
import type { NeedCardNeed } from "@/components/NeedCard";
import { distanceKm, normalizeText } from "@/lib/utils";
import { DONATION_TYPES, getCategoryConfig } from "@/lib/constants";

const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full flex-col gap-2 bg-gray-100 p-3 dark:bg-gray-900">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
      <div className="min-h-0 flex-1 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
      <div className="flex gap-2">
        <div className="h-10 flex-1 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
        <div className="h-10 flex-1 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
      </div>
    </div>
  ),
});

function isZagrebCity(city: string): boolean {
  const n = city.trim().toLowerCase();
  return n === "zagreb" || n.startsWith("zagreb ");
}

function passesListFilters(
  inst: Institution,
  filters: MapFilters,
  urgentInstitutionIds: Set<string>
): boolean {
  if (
    filters.categories.length > 0 &&
    !filters.categories.includes(inst.category)
  ) {
    return false;
  }
  if (
    filters.donationType != null &&
    !inst.accepts_donations.includes(filters.donationType)
  ) {
    return false;
  }
  if (filters.onlyZagreb && !isZagrebCity(inst.city)) {
    return false;
  }
  if (filters.onlyUrgent && !urgentInstitutionIds.has(inst.id)) {
    return false;
  }
  return true;
}

const defaultFilters: MapFilters = {
  categories: [],
  donationType: null,
  onlyZagreb: false,
  onlyUrgent: false,
};

type SearchableInstitution = {
  inst: Institution;
  name: string;
  description: string;
  items: string;
  location: string;
};

function buildSearchIndex(institutions: Institution[]): SearchableInstitution[] {
  return institutions.map((inst) => {
    const itemLabels = (inst.accepts_donations ?? [])
      .map((dt) => {
        const cfg = DONATION_TYPES[dt];
        return cfg ? `${cfg.label} ${cfg.labelHr}` : "";
      })
      .join(" ");
    return {
      inst,
      name: normalizeText(inst.name),
      description: normalizeText(inst.description ?? ""),
      items: normalizeText(itemLabels),
      location: normalizeText(`${inst.address ?? ""} ${inst.city ?? ""}`),
    };
  });
}

function rankInstitutions(
  index: SearchableInstitution[],
  query: string
): { inst: Institution; score: number }[] {
  const q = normalizeText(query).trim();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);

  const scored: { inst: Institution; score: number }[] = [];
  for (const row of index) {
    let score = 0;
    let allTokensHit = true;

    for (const t of tokens) {
      let tokenScore = 0;
      // Field weights: name (highest) → description → items → location.
      if (row.name.startsWith(t)) tokenScore += 140;
      else if (row.name.includes(` ${t}`)) tokenScore += 110;
      else if (row.name.includes(t)) tokenScore += 80;

      if (row.description.includes(t)) tokenScore += 35;
      if (row.items.includes(t)) tokenScore += 25;
      if (row.location.includes(t)) tokenScore += 15;

      if (tokenScore === 0) {
        allTokensHit = false;
        break;
      }
      score += tokenScore;
    }

    if (allTokensHit && score > 0) scored.push({ inst: row.inst, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export default function MapPage() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [urgentInstitutionIds, setUrgentInstitutionIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<MapFilters>(defaultFilters);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [flyToUserTrigger, setFlyToUserTrigger] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  const handleLocate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("Geolocation is not supported by this browser.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setFlyToUserTrigger((n) => n + 1);
        setLocating(false);
        setMobileView("list");
      },
      (err) => {
        setLocating(false);
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Enable it in your browser settings."
            : err.code === err.TIMEOUT
            ? "Locating took too long. Try again."
            : "Could not determine your location.";
        setGeoError(msg);
        window.setTimeout(() => setGeoError(null), 5000);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [instRes, urgentRes] = await Promise.all([
          fetch("/api/institutions"),
          fetch("/api/needs?urgency=urgent"),
        ]);
        const instJson = (await instRes.json()) as {
          institutions?: Institution[];
          error?: string;
        };
        const urgentJson = (await urgentRes.json()) as {
          needs?: NeedCardNeed[];
          error?: string;
        };
        if (!instRes.ok) {
          throw new Error(instJson.error ?? "Failed to load institutions");
        }
        if (cancelled) return;
        setInstitutions(instJson.institutions ?? []);
        const ids = new Set<string>();
        for (const n of urgentJson.needs ?? []) {
          if (n.institution_id) ids.add(n.institution_id);
        }
        setUrgentInstitutionIds(ids);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Error loading data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const searchIndex = useMemo(
    () => buildSearchIndex(institutions),
    [institutions]
  );

  const trimmedQuery = searchQuery.trim();

  const searchHits = useMemo(() => {
    if (!trimmedQuery) return null;
    return rankInstitutions(searchIndex, trimmedQuery);
  }, [searchIndex, trimmedQuery]);

  const filteredInstitutions = useMemo(() => {
    if (searchHits) {
      // Search active: keep ranking order and apply the FilterBar filters on top.
      return searchHits
        .map((h) => h.inst)
        .filter((i) => passesListFilters(i, filters, urgentInstitutionIds));
    }
    const list = institutions.filter((i) =>
      passesListFilters(i, filters, urgentInstitutionIds)
    );
    if (!userPosition) return list;
    return [...list].sort(
      (a, b) =>
        distanceKm(userPosition.lat, userPosition.lng, a.lat, a.lng) -
        distanceKm(userPosition.lat, userPosition.lng, b.lat, b.lng)
    );
  }, [
    searchHits,
    institutions,
    filters,
    urgentInstitutionIds,
    userPosition,
  ]);

  const institutionsForMap = useMemo(() => {
    if (searchHits) {
      const ids = new Set(searchHits.map((h) => h.inst.id));
      return institutions.filter((i) => ids.has(i.id));
    }
    if (!filters.onlyUrgent) return institutions;
    return institutions.filter((i) => urgentInstitutionIds.has(i.id));
  }, [institutions, searchHits, filters.onlyUrgent, urgentInstitutionIds]);

  const selectedInstitution = useMemo(
    () => institutions.find((i) => i.id === selectedId) ?? null,
    [institutions, selectedId]
  );

  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    setMobileView("list");
  }, []);

  const onPickSearchHit = useCallback((id: string) => {
    setSelectedId(id);
    setSearchOpen(false);
    setMobileView("list");
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    function onClick(e: MouseEvent) {
      const node = searchContainerRef.current;
      if (node && e.target instanceof Node && !node.contains(e.target)) {
        setSearchOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSearchOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [searchOpen]);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-64px)] flex-col gap-3 bg-white p-4 dark:bg-gray-950 md:flex-row">
        <div className="h-[45vh] animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800 md:h-full md:w-[60%]" />
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:w-[40%]">
          <div className="h-24 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
          <div className="min-h-0 flex-1 space-y-3 overflow-hidden">
            <div className="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
            <div className="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
            <div className="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-[calc(100vh-64px)] items-center justify-center px-4">
        <p className="text-center text-red-600">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-[calc(100vh-64px)] flex-col overflow-hidden md:flex-row">
      <div
        className={clsx(
          "relative min-h-0 min-w-0 md:h-full md:w-[60%]",
          mobileView === "list" ? "hidden md:block" : "flex flex-1 flex-col"
        )}
      >
        <div className="h-full min-h-[240px] w-full flex-1 md:min-h-0">
          <Map
            institutions={institutionsForMap}
            selectedId={selectedId}
            onSelect={onSelect}
            filters={filters}
            userPosition={userPosition}
            flyToUserTrigger={flyToUserTrigger}
          />
        </div>

        <div
          ref={searchContainerRef}
          className="absolute left-4 right-4 top-4 z-[400] md:right-auto md:w-[28rem]"
        >
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-3 h-4 w-4 text-gray-400"
              aria-hidden
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search by name, description, items, or city…"
              className="w-full rounded-full border border-gray-200 bg-white py-2.5 pl-10 pr-10 text-sm text-gray-900 shadow-lg outline-none ring-0 placeholder:text-gray-400 focus:border-red-300 focus:ring-2 focus:ring-red-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-red-700 dark:focus:ring-red-900/50"
              aria-label="Search institutions"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSearchOpen(false);
                }}
                aria-label="Clear search"
                className="absolute right-2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>

          {searchOpen && trimmedQuery && searchHits ? (
            <div className="mt-2 max-h-[60vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
              {searchHits.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                  No matches for &ldquo;{trimmedQuery}&rdquo;.
                </div>
              ) : (
                <>
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                    {searchHits.slice(0, 8).map(({ inst }) => {
                      const cat = getCategoryConfig(inst.category);
                      return (
                        <li key={inst.id}>
                          <button
                            type="button"
                            onClick={() => onPickSearchHit(inst.id)}
                            className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition hover:bg-gray-50 dark:hover:bg-gray-800"
                          >
                            <span
                              className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: cat.color }}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                                {inst.name}
                              </span>
                              <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                                {cat.label}
                                {inst.city ? ` • ${inst.city}` : ""}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {searchHits.length > 8 ? (
                    <div className="border-t border-gray-100 px-3 py-2 text-center text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                      +{searchHits.length - 8} more — see the list →
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleLocate}
          disabled={locating}
          aria-label="Locate me"
          title="Locate me"
          className="absolute bottom-4 right-4 z-[400] flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-lg ring-1 ring-gray-200 transition hover:bg-gray-50 disabled:opacity-60 dark:bg-gray-900 dark:text-gray-100 dark:ring-gray-700 dark:hover:bg-gray-800"
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <LocateFixed
              className={clsx(
                "h-4 w-4",
                userPosition ? "text-blue-600" : "text-gray-700 dark:text-gray-200"
              )}
              aria-hidden
            />
          )}
          <span className="hidden sm:inline">
            {userPosition ? "Recenter on me" : "Locate me"}
          </span>
        </button>

        {geoError ? (
          <div
            role="alert"
            className="absolute bottom-20 right-4 z-[400] max-w-[80%] rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white shadow-lg"
          >
            {geoError}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setMobileView("list")}
          className="absolute bottom-4 left-1/2 z-[400] flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg md:hidden"
        >
          <List className="h-4 w-4" aria-hidden />
          Institution list
        </button>
      </div>

      <aside
        className={clsx(
          "flex min-h-0 flex-col border-t border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:md:border-gray-800 md:h-full md:w-[40%] md:border-l md:border-t-0",
          mobileView === "map" ? "hidden md:flex" : "flex flex-1"
        )}
      >
        <button
          type="button"
          onClick={() => setMobileView("map")}
          className="flex items-center justify-center gap-2 border-b border-gray-200 bg-white py-3 text-sm font-semibold text-red-600 dark:border-gray-800 dark:bg-gray-900 md:hidden"
        >
          <MapIcon className="h-4 w-4" aria-hidden />
          Show map
        </button>

        <div className="hide-scrollbar shrink-0 border-b border-gray-200 bg-white px-3 py-3 dark:border-gray-800 dark:bg-gray-900">
          <FilterBar filters={filters} onChange={setFilters} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {selectedInstitution ? (
            <InstitutionDetailPanel
              institution={selectedInstitution}
              onClose={() => setSelectedId(null)}
            />
          ) : filteredInstitutions.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No institutions match your filters.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {filteredInstitutions.map((inst) => (
                <li key={inst.id}>
                  <InstitutionCard
                    institution={inst}
                    isSelected={inst.id === selectedId}
                    onClick={() => setSelectedId(inst.id)}
                    distanceKm={
                      userPosition
                        ? distanceKm(
                            userPosition.lat,
                            userPosition.lng,
                            inst.lat,
                            inst.lng
                          )
                        : null
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
