"use client";

import dynamic from "next/dynamic";
import {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import {
  AlertTriangle,
  List,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { MapFilters, MapViewport } from "@/components/Map";
import { FilterBar } from "@/components/FilterBar";
import { InstitutionCard } from "@/components/InstitutionCard";
import { InstitutionDetailPanel } from "@/components/InstitutionDetailPanel";
import { useLocale, useT } from "@/i18n/client";
import {
  CROATIA_INITIAL_VIEW,
  MAP_FEATURE_LIMIT,
  MAP_LIST_RENDER_LIMIT,
  buildMapQueryString,
  isInstitutionFeature,
  parseMapQuery,
  type MapQuery,
  type PublicInstitutionDetail,
  type PublicMapFeature,
  type PublicMapResponse,
} from "@/lib/location-map";
import { distanceKm } from "@/lib/utils";
import { getCategoryConfig } from "@/lib/constants";

const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full flex-col gap-2 bg-gray-100 p-3 dark:bg-gray-900">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
      <div className="min-h-0 flex-1 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
    </div>
  ),
});

const DEFAULT_FILTERS: MapFilters = {
  categories: [],
  donationType: null,
  onlyZagreb: false,
  onlyUrgent: false,
};

type MapMeta = PublicMapResponse["meta"];

function defaultMeta(): MapMeta {
  return {
    returned: 0,
    totalMatches: 0,
    totalFeatures: 0,
    truncated: false,
    mode: "clusters",
    limit: MAP_FEATURE_LIMIT,
  };
}

function initialState(searchParams: URLSearchParams): {
  viewport: MapViewport;
  filters: MapFilters;
  search: string;
  selectedId: string | null;
} {
  const params = new URLSearchParams(searchParams);
  if (!params.has("bbox")) {
    params.set("bbox", CROATIA_INITIAL_VIEW.bbox.join(","));
  }
  if (!params.has("zoom")) params.set("zoom", String(CROATIA_INITIAL_VIEW.zoom));
  if (!params.has("limit")) params.set("limit", String(MAP_FEATURE_LIMIT));

  try {
    const parsed = parseMapQuery(params);
    return {
      viewport: { bbox: parsed.bbox, zoom: parsed.zoom },
      filters: {
        categories: parsed.categories,
        donationType: parsed.donationType,
        onlyZagreb: parsed.onlyZagreb,
        onlyUrgent: parsed.onlyUrgent,
      },
      search: params.get("q") ?? "",
      selectedId: params.get("institution"),
    };
  } catch {
    return {
      viewport: {
        bbox: CROATIA_INITIAL_VIEW.bbox,
        zoom: CROATIA_INITIAL_VIEW.zoom,
      },
      filters: DEFAULT_FILTERS,
      search: "",
      selectedId: null,
    };
  }
}

function MapPageLoading() {
  return (
    <div className="flex h-[calc(100vh-64px)] flex-col gap-3 bg-white p-4 dark:bg-gray-950 md:flex-row">
      <div className="h-[45vh] animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800 md:h-full md:w-[60%]" />
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:w-[40%]">
        <div className="h-24 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
        <div className="min-h-0 flex-1 space-y-3 overflow-hidden">
          <div className="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
          <div className="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
        </div>
      </div>
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<MapPageLoading />}>
      <MapExperience />
    </Suspense>
  );
}

function MapExperience() {
  const t = useT();
  const { locale } = useLocale();
  const searchParams = useSearchParams();
  const initial = useMemo(
    () => initialState(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );
  const [viewport, setViewport] = useState<MapViewport>(initial.viewport);
  const [filters, setFilters] = useState<MapFilters>(initial.filters);
  const [searchQuery, setSearchQuery] = useState(initial.search);
  const deferredSearch = useDeferredValue(searchQuery);
  const [settledSearch, setSettledSearch] = useState(
    initial.search.trim().length >= 2 ? initial.search.trim() : ""
  );
  const [features, setFeatures] = useState<PublicMapFeature[]>([]);
  const [meta, setMeta] = useState<MapMeta>(defaultMeta);
  const [selectedId, setSelectedId] = useState<string | null>(initial.selectedId);
  const [selectedDetail, setSelectedDetail] = useState<PublicInstitutionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [flyToUserTrigger, setFlyToUserTrigger] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const viewportTimerRef = useRef<number | null>(null);
  const requestSequenceRef = useRef(0);

  const initialCenter = useMemo<[number, number]>(() => {
    const [minLng, minLat, maxLng, maxLat] = initial.viewport.bbox;
    return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
  }, [initial.viewport.bbox]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = deferredSearch.trim();
      setSettledSearch(trimmed.length >= 2 ? trimmed : "");
    }, 280);
    return () => window.clearTimeout(timer);
  }, [deferredSearch]);

  const handleViewportChange = useCallback((nextViewport: MapViewport) => {
    if (viewportTimerRef.current) window.clearTimeout(viewportTimerRef.current);
    viewportTimerRef.current = window.setTimeout(() => {
      setViewport((current) => {
        const nextKey = `${nextViewport.zoom}:${nextViewport.bbox.map((value) => value.toFixed(4)).join(",")}`;
        const currentKey = `${current.zoom}:${current.bbox.map((value) => value.toFixed(4)).join(",")}`;
        return nextKey === currentKey ? current : nextViewport;
      });
    }, 160);
  }, []);

  useEffect(
    () => () => {
      if (viewportTimerRef.current) window.clearTimeout(viewportTimerRef.current);
    },
    []
  );

  const mapQuery = useMemo<MapQuery>(
    () => ({
      bbox: viewport.bbox,
      zoom: viewport.zoom,
      categories: filters.categories,
      donationType: filters.donationType,
      onlyZagreb: filters.onlyZagreb,
      onlyUrgent: filters.onlyUrgent,
      query: settledSearch || null,
      limit: MAP_FEATURE_LIMIT,
    }),
    [filters, settledSearch, viewport]
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const query = new URLSearchParams(buildMapQueryString(mapQuery));
    if (selectedId) query.set("institution", selectedId);
    url.search = query.toString();
    window.history.replaceState(window.history.state, "", url);
  }, [mapQuery, selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++requestSequenceRef.current;
    const hasCurrentData = features.length > 0;
    setLoadError(null);
    setRefreshing(hasCurrentData);
    if (!hasCurrentData) setLoading(true);

    (async () => {
      try {
        const response = await fetch(
          `/api/v1/map/institutions?${buildMapQueryString(mapQuery)}`,
          { signal: controller.signal }
        );
        const result = (await response.json()) as PublicMapResponse & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error("map_page.load_error");
        }
        if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
        setFeatures(result.features);
        setMeta(result.meta);
      } catch (error) {
        if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
        setLoadError(error instanceof Error ? error.message : "map_page.load_error");
      } finally {
        if (!controller.signal.aborted && sequence === requestSequenceRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => controller.abort();
    // retryToken intentionally retries the same normalized query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapQuery, retryToken]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    setSelectedDetail(null);
    setDetailError(null);
    setDetailLoading(true);

    (async () => {
      try {
        const response = await fetch(`/api/v1/institutions/${selectedId}`, {
          signal: controller.signal,
        });
        const result = (await response.json()) as {
          institution?: PublicInstitutionDetail;
          error?: string;
        };
        if (!response.ok || !result.institution) {
          throw new Error("map_page.detail_error");
        }
        if (!controller.signal.aborted) setSelectedDetail(result.institution);
      } catch (error) {
        if (!controller.signal.aborted) {
          setDetailError(error instanceof Error ? error.message : "map_page.detail_error");
        }
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    })();

    return () => controller.abort();
  }, [selectedId]);

  const institutions = useMemo(
    () => features.filter(isInstitutionFeature),
    [features]
  );

  const institutionRows = useMemo(() => {
    const rows = institutions.map((institution) => ({
      institution,
      distance: userPosition
        ? distanceKm(
            userPosition.lat,
            userPosition.lng,
            institution.latitude,
            institution.longitude
          )
        : null,
    }));
    if (userPosition) {
      rows.sort((left, right) => (left.distance ?? 0) - (right.distance ?? 0));
    }
    return rows.slice(0, MAP_LIST_RENDER_LIMIT);
  }, [institutions, userPosition]);

  const searchHits = settledSearch ? institutions.slice(0, 8) : [];

  const handleLocate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("map_page.geo_unsupported");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserPosition({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setFlyToUserTrigger((value) => value + 1);
        setLocating(false);
        setMobileView("list");
      },
      (error) => {
        setLocating(false);
        const message =
          error.code === error.PERMISSION_DENIED
            ? "map_page.geo_denied"
            : error.code === error.TIMEOUT
              ? "map_page.geo_timeout"
              : "map_page.geo_failed";
        setGeoError(message);
        window.setTimeout(() => setGeoError(null), 5000);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    setMobileView("list");
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    function onClick(event: MouseEvent) {
      const node = searchContainerRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setSearchOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSearchOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [searchOpen]);

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
            features={features}
            selectedId={selectedId}
            onSelect={onSelect}
            onViewportChange={handleViewportChange}
            initialCenter={initialCenter}
            initialZoom={initial.viewport.zoom}
            userPosition={userPosition}
            flyToUserTrigger={flyToUserTrigger}
          />
        </div>

        <div
          ref={searchContainerRef}
          className="absolute left-1/2 top-4 z-[400] w-[calc(100%-7rem)] max-w-[28rem] -translate-x-1/2"
        >
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-3 h-4 w-4 text-gray-400"
              aria-hidden
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder={t("map_page.search_placeholder")}
              className="w-full rounded-full border border-gray-200 bg-white py-2.5 pl-10 pr-10 text-sm text-gray-900 shadow-lg outline-none placeholder:text-gray-400 focus:border-red-300 focus:ring-2 focus:ring-red-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-red-700 dark:focus:ring-red-900/50"
              aria-label={t("map_page.search_aria")}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searchOpen}
              aria-controls="map-search-results"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSettledSearch("");
                  setSearchOpen(false);
                }}
                aria-label={t("map_page.clear_search")}
                className="absolute right-2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>

          {searchOpen && searchQuery.trim() ? (
            <div
              id="map-search-results"
              role="listbox"
              aria-label={t("map_page.search_aria")}
              className="mt-2 max-h-[60vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
            >
              {searchQuery.trim().length < 2 ? (
                <div className="px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  {t("map_page.type_more")}
                </div>
              ) : loading || refreshing || searchQuery.trim() !== settledSearch ? (
                <div className="flex items-center justify-center gap-2 px-4 py-4 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("map_page.searching")}
                </div>
              ) : searchHits.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                  {t("map_page.no_matches")}
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {searchHits.map((institution) => {
                    const category = getCategoryConfig(institution.category);
                    return (
                      <li key={institution.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={institution.id === selectedId}
                          onClick={() => {
                            onSelect(institution.id);
                            setSearchOpen(false);
                          }}
                          className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          <span
                            className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: category.color }}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                              {institution.name}
                            </span>
                            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                              {locale === "hr" ? category.labelHr : category.label}
                              {institution.city ? ` • ${institution.city}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        {refreshing ? (
          <div className="pointer-events-none absolute left-4 top-16 z-[350] flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-600 shadow dark:bg-gray-900/95 dark:text-gray-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {t("map_page.updating")}
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleLocate}
          disabled={locating}
          aria-label={t("map_page.locate")}
          title={t("map_page.locate")}
          className="absolute bottom-10 right-4 z-[400] flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-lg ring-1 ring-gray-200 transition hover:bg-gray-50 disabled:opacity-60 dark:bg-gray-900 dark:text-gray-100 dark:ring-gray-700 dark:hover:bg-gray-800"
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
            {userPosition ? t("map_page.recenter") : t("map_page.locate")}
          </span>
        </button>

        {geoError ? (
          <div
            role="alert"
            className="absolute bottom-24 right-4 z-[400] max-w-[80%] rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white shadow-lg"
          >
            {t(geoError)}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setMobileView("list")}
          className="absolute bottom-4 left-1/2 z-[400] flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg md:hidden"
        >
          <List className="h-4 w-4" aria-hidden />
          {t("map_page.institution_list")}
        </button>
      </div>

      <aside
        className={clsx(
          "flex min-h-0 flex-col border-t border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900 md:h-full md:w-[40%] md:border-l md:border-t-0",
          mobileView === "map" ? "hidden md:flex" : "flex flex-1"
        )}
      >
        <button
          type="button"
          onClick={() => setMobileView("map")}
          className="flex items-center justify-center gap-2 border-b border-gray-200 bg-white py-3 text-sm font-semibold text-red-600 dark:border-gray-800 dark:bg-gray-900 md:hidden"
        >
          <MapIcon className="h-4 w-4" aria-hidden />
          {t("map_page.show_map")}
        </button>

        <div className="hide-scrollbar shrink-0 border-b border-gray-200 bg-white px-3 py-3 dark:border-gray-800 dark:bg-gray-900">
          <FilterBar filters={filters} onChange={setFilters} />
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
            <p aria-live="polite">
              {loading
                ? t("map_page.loading")
                : meta.mode === "clusters"
                  ? t("map_page.clusters_count", { count: meta.totalMatches.toLocaleString(locale) })
                  : t("map_page.area_count", { count: meta.totalMatches.toLocaleString(locale) })}
            </p>
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {loadError ? (
            <div role="alert" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>{t(loadError)}</p>
              </div>
              <button
                type="button"
                onClick={() => setRetryToken((value) => value + 1)}
                className="mt-2 inline-flex items-center gap-1.5 font-semibold underline underline-offset-2"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {t("map_page.retry")}
              </button>
            </div>
          ) : null}

          {selectedId ? (
            detailLoading ? (
              <div className="space-y-3 rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="h-6 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                <div className="h-24 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
              </div>
            ) : selectedDetail ? (
              <InstitutionDetailPanel
                institution={selectedDetail}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <p>{t(detailError ?? "map_page.detail_error")}</p>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="mt-2 font-semibold underline"
                >
                  {t("map_page.back_results")}
                </button>
              </div>
            )
          ) : loading && features.length === 0 ? (
            <div className="space-y-3">
              <div className="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
              <div className="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
            </div>
          ) : meta.mode === "clusters" ? (
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-5 text-center text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
              <MapIcon className="mx-auto mb-2 h-6 w-6" aria-hidden />
              {t("map_page.cluster_hint")}
            </div>
          ) : institutionRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {t("map_page.empty")}
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {institutionRows.map(({ institution, distance }) => (
                  <li key={institution.id}>
                    <InstitutionCard
                      institution={institution}
                      isSelected={institution.id === selectedId}
                      onClick={() => onSelect(institution.id)}
                      distanceKm={distance}
                    />
                  </li>
                ))}
              </ul>
              {(meta.truncated || institutions.length > MAP_LIST_RENDER_LIMIT) ? (
                <p className="mt-3 rounded-lg bg-gray-100 px-3 py-2 text-center text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {t("map_page.bounded")}
                </p>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
