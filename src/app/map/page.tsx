"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { List, Map as MapIcon } from "lucide-react";
import type { Institution } from "@/lib/types";
import type { MapFilters } from "@/components/Map";
import { FilterBar } from "@/components/FilterBar";
import { InstitutionCard } from "@/components/InstitutionCard";
import { InstitutionDetailPanel } from "@/components/InstitutionDetailPanel";
import type { NeedCardNeed } from "@/components/NeedCard";

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

  const filteredInstitutions = useMemo(
    () =>
      institutions.filter((i) =>
        passesListFilters(i, filters, urgentInstitutionIds)
      ),
    [institutions, filters, urgentInstitutionIds]
  );

  const institutionsForMap = useMemo(() => {
    if (!filters.onlyUrgent) return institutions;
    return institutions.filter((i) => urgentInstitutionIds.has(i.id));
  }, [institutions, filters.onlyUrgent, urgentInstitutionIds]);

  const selectedInstitution = useMemo(
    () => institutions.find((i) => i.id === selectedId) ?? null,
    [institutions, selectedId]
  );

  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    setMobileView("list");
  }, []);

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
          />
        </div>

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
