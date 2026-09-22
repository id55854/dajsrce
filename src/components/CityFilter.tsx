"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import type { PublicMapCity } from "@/lib/location-map";
import { FilterDropdown } from "./FilterDropdown";

/** Fetch bounded official city matches only while the picker is open. */
export function CityFilter({ value, onChange }: {
  value: string | null;
  onChange: (city: string | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [cities, setCities] = useState<PublicMapCity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: "40" });
        if (term.trim()) params.set("q", term.trim());
        const response = await fetch(`/api/v1/map/cities?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("cities_unavailable");
        const result = await response.json() as { cities: PublicMapCity[] };
        if (!controller.signal.aborted) setCities(result.cities);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [term, open]);

  return <FilterDropdown
    label={t("filters.city_label")}
    allLabel={t("filters.city_any")}
    selectedLabel={value ?? t("filters.city_any")}
    value={value ? [value] : []}
    onChange={(next) => onChange(next[0] ?? null)}
    options={cities.map((city) => ({
      key: `${city.county}/${city.city}`,
      value: city.city,
      label: city.city,
      description: city.county,
    }))}
    searchable
    searchLabel={t("filters.city_search")}
    emptyLabel={t("filters.city_none")}
    loading={loading}
    error={error ? t("map_start.city_error") : null}
    onOpenChange={(next) => { setOpen(next); if (next) { setLoading(true); setError(false); } }}
    onSearchChange={(next) => { setTerm(next); setLoading(true); setError(false); }}
  />;
}
