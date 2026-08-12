"use client";

import dynamic from "next/dynamic";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import {
  AlertTriangle,
  Loader2,
  LocateFixed,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
  ZoomIn,
} from "lucide-react";
import type { MapCommand, MapFilters, MapViewport } from "@/components/Map";
import { FilterBar } from "@/components/FilterBar";
import { Button, Menu, Sheet, Skeleton } from "@/components/ui";
import { DetailOverlay } from "./detail-overlay";
import { MapFilterPanel } from "./filter-panel";
import { ResultsList, type ClusterRow, type InstitutionRow } from "./results-list";
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
  type PublicMapCluster,
  type PublicMapFeature,
  type PublicMapInstitution,
  type PublicMapResponse,
} from "@/lib/location-map";
import { distanceKm } from "@/lib/utils";
import { getCategoryConfig } from "@/lib/constants";

const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-surface-sunken" />,
});

const DEFAULT_FILTERS: MapFilters = {
  categories: [],
  donationType: null,
  onlyZagreb: false,
  onlyUrgent: false,
};

/**
 * Peek shows the sheet header (search, filters, count); the middle shows the
 * list against a still-usable map; the top is for reading a detail. The top
 * detent stops short of 1 so the map never disappears completely.
 */
const SHEET_DETENTS = [0.26, 0.56, 0.92];
const SHEET_PEEK = 0;
const SHEET_MIDDLE = 1;
const SHEET_FULL = SHEET_DETENTS.length - 1;

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

/**
 * True below `md`, i.e. when the bottom sheet owns the results.
 *
 * The layout itself stays CSS-driven (so it never flashes the wrong shape on
 * first paint); this only decides *which* container the rows are mounted into,
 * because rendering them in both would put 120 cards in the DOM against a
 * 60-row budget. It resolves before any data arrives, so nothing visibly moves.
 */
function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return compact;
}

function MapPageLoading() {
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-surface md:flex-row md:gap-6 md:px-8 md:pt-8 lg:px-10 lg:pt-10">
      <Skeleton className="min-h-0 flex-1 rounded-none md:h-auto md:w-[60%] md:rounded-sheet md:mb-8 lg:mb-10" />
      <div className="hidden min-h-0 flex-col gap-3 p-3 md:flex md:h-full md:w-[40%]">
        <Skeleton className="h-12 w-full rounded-card" />
        <Skeleton className="h-4 w-40" />
        <div className="min-h-0 flex-1 space-y-3 overflow-hidden">
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-28 rounded-card" />
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
  const compact = useCompactViewport();
  const router = useRouter();
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
  const [sheetDetent, setSheetDetent] = useState(SHEET_PEEK);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [mapCommand, setMapCommand] = useState<MapCommand | null>(null);
  const mapCommandTokenRef = useRef(0);
  const viewportTimerRef = useRef<number | null>(null);
  const requestSequenceRef = useRef(0);
  /** Last selection this component wrote to history; guards push/pop loops. */
  const historySelectionRef = useRef<string | null>(initial.selectedId);
  /** True while a history entry we pushed for the open selection is on top. */
  const pushedSelectionRef = useRef(false);
  /** Latest query string (viewport/filters/search) for popstate URL repair. */
  const querySyncRef = useRef<string>("");

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

  // Pan/zoom/filter/search stay on replaceState (they must not spam history).
  // Opening a selection pushes exactly one entry so Back closes the detail panel.
  useEffect(() => {
    const url = new URL(window.location.href);
    const query = new URLSearchParams(buildMapQueryString(mapQuery));
    querySyncRef.current = query.toString();
    if (selectedId) query.set("institution", selectedId);
    url.search = query.toString();

    const previousSelection = historySelectionRef.current;
    historySelectionRef.current = selectedId;

    if (previousSelection === selectedId) {
      window.history.replaceState(window.history.state, "", url);
      return;
    }

    if (selectedId) {
      if (previousSelection) {
        // Switching institutions replaces the single selection entry.
        window.history.replaceState(window.history.state, "", url);
        return;
      }
      window.history.pushState(window.history.state, "", url);
      pushedSelectionRef.current = true;
      return;
    }

    if (pushedSelectionRef.current) {
      // Closing pops the entry we pushed; popstate repairs the URL.
      pushedSelectionRef.current = false;
      window.history.back();
      return;
    }
    window.history.replaceState(window.history.state, "", url);
  }, [mapQuery, selectedId]);

  // Browser Back/Forward drives the selection, so Back closes the detail panel
  // instead of leaving the app.
  useEffect(() => {
    function onPopState() {
      const nextSelection = new URLSearchParams(window.location.search).get("institution");
      historySelectionRef.current = nextSelection;
      pushedSelectionRef.current = Boolean(nextSelection);
      const query = new URLSearchParams(querySyncRef.current);
      if (nextSelection) query.set("institution", nextSelection);
      else query.delete("institution");
      const url = new URL(window.location.href);
      url.search = query.toString();
      window.history.replaceState(window.history.state, "", url);
      setSelectedId(nextSelection);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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

  const institutionRows = useMemo<InstitutionRow[]>(() => {
    const rows = institutions.map((institution) => ({
      institution,
      distance: userPosition && institution.locationPrecision === "exact"
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

  // At cluster zoom the panel indexes the groups the map is already drawing:
  // nearest first when we know where the user is, largest first otherwise. Still
  // capped at the DOM row budget.
  const clusterRows = useMemo<ClusterRow[]>(() => {
    const rows = features
      .filter((feature): feature is PublicMapCluster => feature.kind === "cluster")
      .map((cluster) => ({
        cluster,
        distance: userPosition
          ? distanceKm(
              userPosition.lat,
              userPosition.lng,
              cluster.latitude,
              cluster.longitude
            )
          : null,
      }));
    rows.sort((left, right) =>
      userPosition
        ? (left.distance ?? 0) - (right.distance ?? 0)
        : right.cluster.count - left.cluster.count
    );
    return rows.slice(0, MAP_LIST_RENDER_LIMIT);
  }, [features, userPosition]);

  const searchHits = useMemo<PublicMapInstitution[]>(
    () => (settledSearch ? institutions.slice(0, 8) : []),
    [institutions, settledSearch]
  );

  const activeFilterCount =
    filters.categories.length +
    (filters.donationType ? 1 : 0) +
    (filters.onlyZagreb ? 1 : 0) +
    (filters.onlyUrgent ? 1 : 0);

  const listCount =
    meta.mode === "clusters" ? clusterRows.length : institutionRows.length;
  // Up to 90 fetched institutions can be drawn on the map yet absent from the
  // list (150-feature fetch budget against 60 rendered rows). Say so where the
  // count is, with a way out.
  const showTruncation =
    !loading &&
    (meta.truncated ||
      (meta.mode === "institutions" && meta.totalMatches > listCount));

  const nextCommandToken = useCallback(() => {
    mapCommandTokenRef.current += 1;
    return mapCommandTokenRef.current;
  }, []);

  const zoomBy = useCallback(
    (delta: number) => {
      setMapCommand({ token: nextCommandToken(), kind: "zoom", delta });
    },
    [nextCommandToken]
  );

  const focusCluster = useCallback(
    (cluster: PublicMapCluster) => {
      setMapCommand({
        token: nextCommandToken(),
        kind: "fitBounds",
        bounds: cluster.bounds,
      });
      // Get out of the way so the move is visible; the results for the new area
      // are one drag away.
      setSheetDetent(SHEET_PEEK);
    },
    [nextCommandToken]
  );

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
        setMapCommand({
          token: nextCommandToken(),
          kind: "flyTo",
          center: [position.coords.latitude, position.coords.longitude],
          zoom: 14,
        });
        setLocating(false);
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
  }, [nextCommandToken]);

  const onSelect = useCallback(
    (id: string) => {
      if (id.startsWith("registry:")) {
        router.push(`/organisations/${encodeURIComponent(id.slice("registry:".length))}`);
        return;
      }
      setSelectedId(id);
      // Open the sheet far enough that the detail is readable while the map
      // stays visible above it.
      setSheetDetent((current) => Math.max(current, SHEET_MIDDLE));
    },
    [router]
  );

  const closeDetail = useCallback(() => setSelectedId(null), []);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSettledSearch("");
    // A cleared query must not leave a detail open for a result that is no
    // longer in the list.
    setSelectedId(null);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setFilterPanelOpen(false);
  }, []);

  const detailOpen = Boolean(selectedId);
  const searchPending =
    loading || refreshing || searchQuery.trim() !== settledSearch;

  const resultsMeta = (
    <ResultsMeta
      loading={loading}
      refreshing={refreshing}
      mode={meta.mode}
      totalMatches={meta.totalMatches}
      listCount={listCount}
      showTruncation={showTruncation}
      locale={locale}
      onZoomIn={() => zoomBy(1)}
    />
  );

  const results = (
    <>
      {loadError ? (
        <LoadErrorNotice
          message={loadError}
          onRetry={() => setRetryToken((value) => value + 1)}
        />
      ) : null}
      <ResultsList
        mode={meta.mode}
        loading={loading && features.length === 0}
        refreshing={refreshing}
        institutionRows={institutionRows}
        clusterRows={clusterRows}
        selectedId={selectedId}
        canClearFilters={activeFilterCount > 0}
        onSelectInstitution={onSelect}
        onFocusCluster={focusCluster}
        onClearFilters={clearFilters}
        onZoomOut={() => zoomBy(-2)}
      />
    </>
  );

  return (
    // Bottom padding lives on the map card, not the container, so the results
    // list on the right can scroll all the way to the screen's bottom edge.
    <div className="relative flex h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-surface md:flex-row md:gap-6 md:px-8 md:pt-8 lg:px-10 lg:pt-10">
      {/* The map is always mounted and always interactive: on phones the sheet
          floats over it (full-bleed), on desktop it holds the left 60% as a
          rounded card inset from the page edges. `isolate` keeps Leaflet's
          internal pane z-indexes out of the app's ladder. */}
      <div className="relative isolate min-h-0 min-w-0 flex-1 md:h-auto md:w-[60%] md:overflow-hidden md:rounded-sheet md:shadow-raised md:mb-8 lg:mb-10">
        <div className="h-full w-full">
          <Map
            features={features}
            selectedId={selectedId}
            onSelect={onSelect}
            onViewportChange={handleViewportChange}
            initialCenter={initialCenter}
            initialZoom={initial.viewport.zoom}
            userPosition={userPosition}
            command={mapCommand}
          />
        </div>

        {refreshing ? (
          <div
            data-ui-material
            className="pointer-events-none absolute left-3 top-3 z-[var(--z-chrome)] hidden items-center gap-2 rounded-full border border-border-subtle bg-chrome px-3 py-1.5 text-xs font-medium text-ink-secondary shadow-overlay backdrop-blur-md md:flex"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{" "}
            {t("map_page.updating")}
          </div>
        ) : null}

        {/* Sits below the zoom control (two 44px buttons from top-3) so the two
            never collide, and clear of the attribution at any width. */}
        <div className="absolute right-3 top-28 z-[var(--z-chrome)] flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={handleLocate}
            disabled={locating}
            aria-label={userPosition ? t("map_page.recenter") : t("map_page.locate")}
            title={userPosition ? t("map_page.recenter") : t("map_page.locate")}
            data-ui-material
            className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-border-subtle bg-chrome px-3 text-sm font-semibold text-ink shadow-overlay backdrop-blur-md transition-[background-color,transform] duration-150 ease-out hover:bg-surface-sunken motion-safe:active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-60"
          >
            {locating ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : (
              <LocateFixed
                className={clsx("h-5 w-5", userPosition ? "text-info" : "text-ink")}
                aria-hidden
              />
            )}
            <span className="hidden lg:inline">
              {userPosition ? t("map_page.recenter") : t("map_page.locate")}
            </span>
          </button>

          {geoError ? (
            <div
              role="alert"
              className="max-w-[14rem] rounded-control bg-danger px-3 py-2 text-xs font-medium text-white shadow-overlay"
            >
              {t(geoError)}
            </div>
          ) : null}
        </div>

        {/* Phones: one sheet over a live map. Search, filters and the result
            count live in the header, so nothing is gated behind a view swap. */}
        <Sheet
          className="md:hidden"
          detents={SHEET_DETENTS}
          detentIndex={sheetDetent}
          onDetentChange={setSheetDetent}
          ariaLabel={t("map_page.institution_list")}
          handleLabel={
            sheetDetent === SHEET_FULL
              ? t("map_page.show_map")
              : t("map_page.institution_list")
          }
          header={
            <div className="space-y-2">
              {/* Controls stop the drag gesture from starting, so the field can
                  be typed into and a tap cannot be stolen by pointer capture. */}
              <div
                className="select-text"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <MapSearchField
                  idPrefix="sheet-search"
                  tone="inline"
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  onClear={clearSearch}
                  hits={searchHits}
                  pending={searchPending}
                  onSelect={onSelect}
                  // Searching from the peek detent would open the suggestion
                  // list into the 26% of screen below the field; raise the
                  // sheet first so the list has somewhere to go.
                  onOpen={() => setSheetDetent(SHEET_FULL)}
                />
              </div>
              <div className="flex items-center gap-2">
                <div onPointerDown={(event) => event.stopPropagation()}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<SlidersHorizontal className="h-4 w-4" aria-hidden />}
                    onClick={() => setFilterPanelOpen(true)}
                    aria-expanded={filterPanelOpen}
                  >
                    {t("map_page.filters")}
                    {activeFilterCount > 0 ? (
                      <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-bold text-white">
                        {activeFilterCount}
                      </span>
                    ) : null}
                  </Button>
                </div>
                <div className="min-w-0 flex-1">{resultsMeta}</div>
              </div>
            </div>
          }
        >
          <div className="pb-[10dvh]" aria-busy={refreshing}>
            <div className={clsx(detailOpen && "hidden")}>
              {compact ? results : null}
            </div>
            <DetailOverlay
              open={detailOpen && compact}
              variant="inline"
              institution={selectedDetail}
              loading={detailLoading}
              error={detailError}
              onClose={closeDetail}
            />
          </div>
        </Sheet>

        <MapFilterPanel
          open={filterPanelOpen}
          filters={filters}
          onChange={setFilters}
          onClear={clearFilters}
          onClose={() => setFilterPanelOpen(false)}
        />
      </div>

      {/* Desktop: the split stays, but the detail slides in over the list rather
          than replacing it, so scroll position and the clicked card survive. */}
      <aside className="hidden min-h-0 flex-col bg-surface md:flex md:h-full md:w-[40%]">
        <div className="shrink-0 px-3 py-3">
          {/* Desktop search lives above the category row; on phones the same
              field lives in the sheet header instead, reachable at every detent. */}
          <MapSearchField
            idPrefix="map-search"
            tone="inline"
            className="mb-3"
            value={searchQuery}
            onValueChange={setSearchQuery}
            onClear={clearSearch}
            hits={searchHits}
            pending={searchPending}
            onSelect={onSelect}
          />
          <FilterBar filters={filters} onChange={setFilters} />
          <div className="mt-2">{resultsMeta}</div>
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            className="absolute inset-0 overflow-y-auto overscroll-contain p-3"
            aria-busy={refreshing}
          >
            {compact ? null : results}
          </div>
          <DetailOverlay
            open={detailOpen && !compact}
            variant="overlay"
            institution={selectedDetail}
            loading={detailLoading}
            error={detailError}
            onClose={closeDetail}
          />
        </div>
      </aside>
    </div>
  );
}

function ResultsMeta({
  loading,
  refreshing,
  mode,
  totalMatches,
  listCount,
  showTruncation,
  locale,
  onZoomIn,
}: {
  loading: boolean;
  refreshing: boolean;
  mode: MapMeta["mode"];
  totalMatches: number;
  listCount: number;
  showTruncation: boolean;
  locale: string;
  onZoomIn: () => void;
}) {
  const t = useT();
  const count = totalMatches.toLocaleString(locale);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs text-ink-secondary">
        <p aria-live="polite" className="min-w-0 truncate">
          {loading
            ? t("map_page.loading")
            : mode === "clusters"
              ? t("map_page.clusters_count", { count })
              : t("map_page.area_count", { count })}
        </p>
        {refreshing ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        ) : null}
      </div>

      {showTruncation ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control bg-warning-soft px-2.5 py-2 text-xs text-warning-on-soft">
          <span className="font-semibold">
            {listCount.toLocaleString(locale)} / {count}
          </span>
          <span className="min-w-0 flex-1">{t("map_page.bounded")}</span>
          <button
            type="button"
            onClick={onZoomIn}
            // This notice also renders inside the sheet's grab area; a press on
            // a control there must not become a drag.
            onPointerDown={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-full px-1 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <ZoomIn className="h-3.5 w-3.5" aria-hidden />
            {t("map_ui.zoom_in")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function LoadErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className="mb-3 rounded-card border border-border-subtle bg-warning-soft p-3 text-sm text-warning-on-soft"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{t(message)}</p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="mt-2"
        icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        onClick={onRetry}
      >
        {t("map_page.retry")}
      </Button>
    </div>
  );
}

/**
 * The map search combobox. Two instances exist — floating over the tiles on
 * desktop, in the sheet header on phones — so each owns its own open state and
 * its own ids, while the query and the candidate set stay with the page.
 *
 * Roving selection is the part that was missing: the ARIA wiring was complete
 * but there was no `aria-activedescendant` and no arrow keys, so the listbox
 * could only be reached by tabbing through every option.
 */
function MapSearchField({
  idPrefix,
  tone,
  className,
  value,
  onValueChange,
  onClear,
  hits,
  pending,
  onSelect,
  onOpen,
}: {
  idPrefix: string;
  tone: "floating" | "inline";
  className?: string;
  value: string;
  onValueChange: (next: string) => void;
  onClear: () => void;
  hits: PublicMapInstitution[];
  /** A request is in flight, or the debounce has not settled yet. */
  pending: boolean;
  onSelect: (id: string) => void;
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

  // A new candidate set invalidates the cursor.
  useEffect(() => {
    setActiveIndex(-1);
  }, [hits]);

  const closeList = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  function commit(index: number) {
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
    if (hits.length === 0) {
      if (event.key === "ArrowDown") setOpen(true);
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        setActiveIndex((current) => (current + 1) % hits.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setOpen(true);
        setActiveIndex((current) => (current <= 0 ? hits.length - 1 : current - 1));
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
          setActiveIndex(hits.length - 1);
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
      : hits.length === 0
        ? t("map_page.no_matches")
        : null;

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
              // The reference format: a soft filled rounded rectangle rather
              // than a bordered pill. The fill carries the shape; the border
              // only appears as the brand focus ring.
              "h-12 w-full rounded-card border border-transparent pl-10 pr-12 text-sm text-ink outline-none",
              "transition-[background-color,border-color,box-shadow] duration-150 ease-out",
              "placeholder:text-ink-tertiary focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand",
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
                inputRef.current?.focus();
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
            ) : (
              hits.map((institution, index) => {
                const category = getCategoryConfig(institution.category);
                const active = index === activeIndex;
                return (
                  <li key={institution.id}>
                    <button
                      type="button"
                      role="option"
                      id={optionId(index)}
                      aria-selected={active}
                      tabIndex={-1}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => commit(index)}
                      className={clsx(
                        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
                        active ? "bg-surface-sunken" : "hover:bg-surface-sunken"
                      )}
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
