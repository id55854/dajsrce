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
  Building2,
  Loader2,
  LocateFixed,
  SlidersHorizontal,
} from "lucide-react";
import type { MapCommand, MapFilters, MapViewport } from "@/components/Map";
import { FilterBar } from "@/components/FilterBar";
import { MapLegalStrip } from "@/components/Footer";
import { Button, Sheet, Skeleton } from "@/components/ui";
import { DetailOverlay, type MapDetail } from "./detail-overlay";
import { MapFilterPanel } from "./filter-panel";
import { useMapStartPrompt } from "./use-map-start";
import { ResultsList, type ClusterRow, type InstitutionRow } from "./results-list";
import { useLocale, useT } from "@/i18n/client";
import type { AssociationRegistryEntry } from "@/lib/association-registry";
import {
  CROATIA_INITIAL_VIEW,
  MAP_CITY_ZOOM,
  MAP_FEATURE_LIMIT,
  MAP_LIST_RENDER_LIMIT,
  MAP_NEARBY_ZOOM,
  buildBrowserMapParams,
  buildMapQueryString,
  isInstitutionFeature,
  resolveMapCategories,
  splitRegistryFeatureId,
  type MapBounds,
  type MapQuery,
  type PublicInstitutionDetail,
  type PublicMapCity,
  type PublicMapCluster,
  type PublicMapFeature,
  type PublicMapInstitution,
  type PublicMapResponse,
} from "@/lib/location-map";
import { distanceKm } from "@/lib/utils";
import { MapSearchField } from "./map-search-field";
import { ResultsMeta, LoadErrorNotice } from "./results-status";
import { DEFAULT_FILTERS, defaultMeta, initialState, type MapMeta, type MapBootstrap } from "./map-state";

const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-surface-sunken" />,
});

// Neither dialog is needed to draw the map: the first appears only on a first
// visit, the second only when the visitor asks for it. Loading them on demand
// keeps them out of the map route's initial chunk, which has a CI budget.
const LocationStartDialog = dynamic(
  () => import("./location-start").then((module) => module.LocationStartDialog),
  { ssr: false }
);
const CityPickerDialog = dynamic(
  () => import("./location-start").then((module) => module.CityPickerDialog),
  { ssr: false }
);

/** The smallest box around every returned pin and cluster, or null if none. */
function featureBounds(features: PublicMapFeature[]): MapBounds | null {
  if (features.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const feature of features) {
    const [west, south, east, north] =
      feature.kind === "cluster"
        ? feature.bounds
        : [feature.longitude, feature.latitude, feature.longitude, feature.latitude];
    minLng = Math.min(minLng, west);
    minLat = Math.min(minLat, south);
    maxLng = Math.max(maxLng, east);
    maxLat = Math.max(maxLat, north);
  }
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Peek shows the sheet header (search, filters, count); the middle shows the
 * list against a still-usable map; the top is for reading a detail. The top
 * detent stops short of 1 so the map never disappears completely.
 */
const SHEET_DETENTS = [0.26, 0.56, 0.92];
const SHEET_PEEK = 0;
const SHEET_MIDDLE = 1;
const SHEET_FULL = SHEET_DETENTS.length - 1;

/**
 * True below `md`, i.e. when the bottom sheet owns the results.
 *
 * The layout itself stays CSS-driven (so it never flashes the wrong shape on
 * first paint); this only decides *which* container the rows are mounted into,
 * because rendering them in both would put 120 cards in the DOM against a
 * 60-row budget. Until measured, one responsive server-rendered list is visible.
 */
function useCompactViewport(): boolean | null {
  const [compact, setCompact] = useState<boolean | null>(null);

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
    <div className="flex h-[calc(100dvh-var(--nav-height))] flex-col overflow-hidden bg-surface">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row md:gap-4 md:px-4 md:pt-4 lg:px-6 lg:pt-5">
        <Skeleton className="min-h-0 flex-1 rounded-none md:mb-4 md:h-auto md:w-[60%] md:rounded-sheet lg:mb-5" />
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
      <MapLegalStrip />
    </div>
  );
}

/**
 * The map is the site's home page (`/`); `/map` is kept as a permanent
 * redirect so older links and bookmarks still resolve.
 */
export default function MapExperience({ bootstrap = null }: { bootstrap?: MapBootstrap | null }) {
  return (
    <Suspense fallback={<MapPageLoading />}>
      <MapSurface bootstrap={bootstrap} />
    </Suspense>
  );
}

function MapSurface({ bootstrap }: { bootstrap: MapBootstrap | null }) {
  const t = useT();
  const { locale } = useLocale();
  const compact = useCompactViewport();
  const searchParams = useSearchParams();
  const initial = useMemo(
    () => initialState(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );
  const [viewport, setViewport] = useState<MapViewport>(initial.viewport);
  /**
   * Leaflet reports the real bounds on mount, and they are rarely the ones a
   * URL implies. The server snapshot is already visible; only the client
   * refresh waits for this report so it uses the actual viewport.
   */
  const [viewportReady, setViewportReady] = useState(false);
  const [filters, setFilters] = useState<MapFilters>(initial.filters);
  const [searchQuery, setSearchQuery] = useState(initial.search);
  const deferredSearch = useDeferredValue(searchQuery);
  const [settledSearch, setSettledSearch] = useState(
    initial.search.trim().length >= 2 ? initial.search.trim() : ""
  );
  const [features, setFeatures] = useState<PublicMapFeature[]>(bootstrap?.response.features ?? []);
  const [meta, setMeta] = useState<MapMeta>(() => bootstrap?.response.meta ?? defaultMeta());
  const [selectedId, setSelectedId] = useState<string | null>(initial.selectedId);
  const [selectedDetail, setSelectedDetail] = useState<MapDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!bootstrap);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [sheetDetent, setSheetDetent] = useState(bootstrap ? SHEET_MIDDLE : SHEET_PEEK);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const closeFilterPanel = useCallback(() => setFilterPanelOpen(false), []);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const { shouldAsk: shouldAskStart, resolve: resolveStart } = useMapStartPrompt();
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [mapCommand, setMapCommand] = useState<MapCommand | null>(null);
  const mapCommandTokenRef = useRef(0);
  const viewportTimerRef = useRef<number | null>(null);
  /** Mirrors `viewportReady` for the callback, which must not re-create. */
  const viewportReadyRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const bootstrapKeyRef = useRef(bootstrap?.queryKey ?? null);
  /** Last selection this component wrote to history; guards push/pop loops. */
  const historySelectionRef = useRef<string | null>(initial.selectedId);
  /** True while a history entry we pushed for the open selection is on top. */
  const pushedSelectionRef = useRef(false);
  /** Latest query string (viewport/filters/search) for popstate URL repair. */
  const querySyncRef = useRef<string>("");

  const initialCenter = initial.center;

  /**
   * A new search or filter answers for the whole country, not for whatever
   * happened to be in view when it was chosen; once those results arrive the
   * map fits itself around them. Moving the map afterwards narrows the answer
   * to the viewport again, so zooming into a cluster still resolves it.
   *
   * `narrowedScope` is the search/filter state the viewport last took over
   * from. While it differs from the current one, the query is national. A
   * shared link with a search keeps its old nationwide behaviour and its own
   * view (no fit); one without a search starts bounded, as before.
   */
  const scopeKey = JSON.stringify([filters, settledSearch]);
  const scopeKeyRef = useRef(scopeKey);
  const [narrowedScope, setNarrowedScope] = useState<string | null>(() =>
    initial.search.trim().length >= 2 ? null : scopeKey
  );
  const nationalScope = narrowedScope !== scopeKey;
  /** Set when the visitor changes the scope; the next national answer is fitted. */
  const fitPendingRef = useRef(false);

  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return;
    scopeKeyRef.current = scopeKey;
    fitPendingRef.current = true;
  }, [scopeKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = deferredSearch.trim();
      setSettledSearch(trimmed.length >= 2 ? trimmed : "");
    }, 280);
    return () => window.clearTimeout(timer);
  }, [deferredSearch]);

  const handleViewportChange = useCallback((nextViewport: MapViewport) => {
    const commit = (narrow: boolean) => {
      setViewport((current) => {
        const nextKey = `${nextViewport.zoom}:${nextViewport.bbox.map((value) => value.toFixed(4)).join(",")}`;
        const currentKey = `${current.zoom}:${current.bbox.map((value) => value.toFixed(4)).join(",")}`;
        return nextKey === currentKey ? current : nextViewport;
      });
      setViewportReady(true);
      // Leaflet's own mount report is not the visitor moving the map.
      if (narrow) setNarrowedScope(scopeKeyRef.current);
    };

    if (viewportTimerRef.current) window.clearTimeout(viewportTimerRef.current);
    // The mount report is what unblocks the first request, so it must not sit
    // behind the pan debounce; only subsequent moves are coalesced.
    if (!viewportReadyRef.current) {
      viewportReadyRef.current = true;
      commit(false);
      return;
    }
    viewportTimerRef.current = window.setTimeout(() => commit(true), 160);
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
      donationTypes: filters.donationTypes,
      city: filters.city,
      onlyZagreb: filters.onlyZagreb,
      onlyUrgent: filters.onlyUrgent,
      onlyOnboarded: filters.onlyOnboarded,
      query: settledSearch || null,
      limit: MAP_FEATURE_LIMIT,
    }),
    [filters, settledSearch, viewport]
  );
  // `mapQuery` is what the URL describes; this is what the API is asked. The
  // two differ in two places, and both differences are deliberately kept out
  // of the address bar: a fresh search or filter covers the whole country
  // regardless of the viewport (see `nationalScope`), and "social only" expands
  // into the twelve real categories rather than writing all twelve into the URL.
  const apiMapQuery = useMemo<MapQuery>(() => {
    const categories = resolveMapCategories({
      categories: mapQuery.categories,
      onlySocial: filters.onlySocial,
      onlyOnboarded: mapQuery.onlyOnboarded,
    });
    const withCategories =
      categories === mapQuery.categories ? mapQuery : { ...mapQuery, categories };
    return nationalScope
      ? {
          ...withCategories,
          bbox: CROATIA_INITIAL_VIEW.bbox,
          zoom: CROATIA_INITIAL_VIEW.zoom,
        }
      : withCategories;
  }, [mapQuery, filters.onlySocial, nationalScope]);

  // Pan/zoom/filter/search stay on replaceState (they must not spam history).
  // Opening a selection pushes exactly one entry so Back closes the detail panel.
  useEffect(() => {
    const [minLng, minLat, maxLng, maxLat] = mapQuery.bbox;
    const url = new URL(window.location.href);
    const query = buildBrowserMapParams({
      center: [(minLat + maxLat) / 2, (minLng + maxLng) / 2],
      zoom: mapQuery.zoom,
      filters: { ...mapQuery, onlySocial: filters.onlySocial },
      query: mapQuery.query,
      // The selection is appended below, because `querySyncRef` has to hold the
      // view *without* it for the popstate repair.
      selectedId: null,
    });
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
  }, [mapQuery, selectedId, filters.onlySocial]);

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
    // Nothing is fetched against the placeholder viewport; the map's first
    // bounds report is what starts the data flow.
    if (!viewportReady) return;

    // Reuse the server snapshot when the actual viewport has the same key.
    // Consume once: later pans/filter changes and explicit retries stay fresh.
    const bootstrapKey = bootstrapKeyRef.current;
    bootstrapKeyRef.current = null;
    if (retryToken === 0 && bootstrapKey === buildMapQueryString(apiMapQuery)) return;

    const controller = new AbortController();
    const sequence = ++requestSequenceRef.current;
    const hasCurrentData = features.length > 0;
    setLoadError(null);
    setRefreshing(hasCurrentData);
    if (!hasCurrentData) setLoading(true);

    (async () => {
      try {
        const response = await fetch(
          `/api/v1/map/institutions?${buildMapQueryString(apiMapQuery)}`,
          { signal: controller.signal }
        );
        const result = (await response.json()) as PublicMapResponse & {
          error?: string;
          code?: string;
        };
        if (!response.ok) {
          // The route only sends `not_configured` outside production, so this
          // branch is a developer's missing `.env.local` and says so, instead
          // of blaming a server that was never contacted.
          throw new Error(
            result.code === "not_configured"
              ? "map_page.not_configured"
              : "map_page.load_error"
          );
        }
        if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
        setFeatures(result.features);
        setMeta(result.meta);
        if (nationalScope && fitPendingRef.current) {
          fitPendingRef.current = false;
          const bounds = featureBounds(result.features);
          if (bounds) {
            setMapCommand({ token: ++mapCommandTokenRef.current, kind: "fitBounds", bounds });
          }
        }
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
  }, [apiMapQuery, retryToken, viewportReady]);

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

    const registryId = splitRegistryFeatureId(selectedId);

    (async () => {
      try {
        const response = await fetch(
          registryId
            ? `/api/v1/organisations/${encodeURIComponent(registryId)}`
            : `/api/v1/institutions/${selectedId}`,
          { signal: controller.signal }
        );
        const result = (await response.json()) as {
          institution?: PublicInstitutionDetail;
          organisation?: AssociationRegistryEntry;
          error?: string;
        };
        if (!response.ok) throw new Error("map_page.detail_error");
        const next: MapDetail | null = registryId
          ? result.organisation
            ? { kind: "registry", organisation: result.organisation }
            : null
          : result.institution
            ? { kind: "institution", institution: result.institution }
            : null;
        if (!next) throw new Error("map_page.detail_error");
        if (!controller.signal.aborted) setSelectedDetail(next);
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
    filters.donationTypes.length +
    (filters.city ? 1 : 0) +
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
          zoom: MAP_NEARBY_ZOOM,
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

  const handleSelectCity = useCallback(
    (city: PublicMapCity) => {
      setCityPickerOpen(false);
      resolveStart("city");
      setMapCommand({
        token: nextCommandToken(),
        kind: "flyTo",
        center: [city.latitude, city.longitude],
        zoom: MAP_CITY_ZOOM,
      });
    },
    [nextCommandToken, resolveStart]
  );

  const onSelect = useCallback((id: string) => {
    // Register pins used to navigate to `/organisations/[id]`, which replaced
    // the map and the result list with a full page. Every kind of pin now
    // opens the same side panel, and the full record stays one click away
    // inside it.
    setSelectedId(id);
    // Open the sheet far enough that the detail is readable while the map
    // stays visible above it.
    setSheetDetent((current) => Math.max(current, SHEET_MIDDLE));
  }, []);

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
      nationwide={nationalScope}
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
    // One viewport-high column: the map surface takes the remaining space and
    // the registered-name strip closes it. Keeping the strip in flow rather
    // than overlaying it is what stops it colliding with the bottom sheet's
    // peek detent on phones, and the page still never scrolls.
    <div className="flex h-[calc(100dvh-var(--nav-height))] flex-col overflow-hidden bg-surface">
    {/* Bottom spacing lives on the map card, not the container, so the results
        list on the right can scroll all the way down to the legal strip.
        The inset is deliberately slim: it only has to read as a card against
        the page, and every pixel it takes is one the map does not get. */}
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row md:gap-4 md:px-4 md:pt-4 lg:px-6 lg:pt-5">
      {/* The map is always mounted and always interactive: on phones the sheet
          floats over it (full-bleed), on desktop it holds the left 62% as a
          rounded card inset from the page edges. `isolate` keeps Leaflet's
          internal pane z-indexes out of the app's ladder. */}
      <div className="relative isolate min-h-0 min-w-0 flex-1 md:mb-4 md:h-auto md:w-[60%] md:overflow-hidden md:rounded-sheet md:shadow-raised lg:mb-5">
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

          {/* The way in for anyone who will not or cannot share a location.
              It stays available after the opening question is answered, so
              changing city is never a matter of panning across the country. */}
          <button
            type="button"
            onClick={() => setCityPickerOpen(true)}
            aria-label={t("map_start.choose_city")}
            title={t("map_start.choose_city")}
            data-ui-material
            className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-border-subtle bg-chrome px-3 text-sm font-semibold text-ink shadow-overlay backdrop-blur-md transition-[background-color,transform] duration-150 ease-out hover:bg-surface-sunken motion-safe:active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <Building2 className="h-5 w-5" aria-hidden />
            <span className="hidden lg:inline">{t("map_start.city_short")}</span>
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
          className={compact === null ? "hidden" : "md:hidden"}
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
              open={detailOpen && compact === true}
              variant="inline"
              detail={selectedDetail}
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
          onClose={closeFilterPanel}
        />

        <LocationStartDialog
          open={shouldAskStart === true && !cityPickerOpen}
          onUseLocation={() => {
            resolveStart("nearby");
            handleLocate();
          }}
          onChooseCity={() => setCityPickerOpen(true)}
          onShowCountry={() => resolveStart("country")}
        />

        <CityPickerDialog
          open={cityPickerOpen}
          onClose={() => {
            setCityPickerOpen(false);
            // Backing out of the city list without picking one still counts as
            // an answer; the opening question must not spring back.
            if (shouldAskStart) resolveStart("country");
          }}
          onSelect={handleSelectCity}
        />
      </div>

      {/* Desktop: the split stays, but the detail slides in over the list rather
          than replacing it, so scroll position and the clicked card survive.
          Opening a pin must not grow this column; the map keeps its 60%
          and the chrome stays mounted underneath so query and filters survive. */}
      {/* Before hydration the phone gets this column shaped like the sheet it
          turns into (same middle detent, rounded top, filters folded away), so
          nothing jumps when the real sheet takes over. */}
      <aside className={clsx(
        "min-h-0 w-full flex-col overflow-hidden bg-surface md:relative md:flex md:h-full md:w-[40%] md:rounded-none md:border-0 md:shadow-none",
        compact === null
          ? "absolute inset-x-0 bottom-0 flex h-[56%] rounded-t-sheet border-t border-border-subtle shadow-overlay"
          : "relative hidden"
      )}>
        {compact === null ? (
          <div aria-hidden className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border-strong/50 md:hidden" />
        ) : null}
        <div
          className={clsx(
            "flex min-h-0 flex-1 flex-col",
            detailOpen && "hidden"
          )}
        >
          <div className="shrink-0 px-3 py-3">
            {/* Desktop search lives above the category row rather than floating
                over the tiles; on phones the same field lives in the sheet
                header, reachable at every detent. */}
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
            <div className="hidden md:block">
              <FilterBar filters={filters} onChange={setFilters} />
            </div>
            <div className="mt-2">{resultsMeta}</div>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
            aria-busy={refreshing}
          >
            {compact ? null : results}
          </div>
        </div>
        <DetailOverlay
          open={detailOpen && !compact}
          variant="overlay"
          detail={selectedDetail}
          loading={detailLoading}
          error={detailError}
          onClose={closeDetail}
        />
      </aside>
    </div>
      <MapLegalStrip />
    </div>
  );
}
