"use client";

import "leaflet/dist/leaflet.css";

import {
  AttributionControl,
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PIN_STATUS_FILL,
  pinStatus,
  type MapBounds,
  type MapPinStatus,
  type PublicMapCluster,
  type PublicMapFeature,
  type PublicMapInstitution,
} from "@/lib/location-map";
import type { DonationType, InstitutionCategory } from "@/lib/types";
import { getCategoryConfig } from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";

const LIGHT_TILES = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const DARK_TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

export interface MapFilters {
  categories: InstitutionCategory[];
  donationType: DonationType | null;
  /** Exact city name from the register's own list, or null for everywhere. */
  city: string | null;
  onlyZagreb: boolean;
  onlyUrgent: boolean;
  /** Narrow to organisations that hold an account here. Server-side. */
  onlyOnboarded: boolean;
  /**
   * Hide register rows the classifier never placed in a social category.
   * Purely a shortcut for selecting every social category at once, so it has
   * no server contract of its own and an explicit category choice wins.
   */
  onlySocial: boolean;
}

export type MapViewport = {
  bbox: MapBounds;
  zoom: number;
};

/**
 * The one imperative channel from the results panel to the map: a cluster row,
 * the "zoom in" affordance on the truncation notice, "zoom out" on an empty
 * result, and locate-me all travel through here.
 *
 * Every command carries a monotonic token (counting from 1) so re-issuing the
 * same move runs exactly once, without each action inventing its own trigger
 * counter.
 */
export type MapCommand =
  | { token: number; kind: "fitBounds"; bounds: MapBounds }
  | { token: number; kind: "zoom"; delta: number }
  | { token: number; kind: "flyTo"; center: [number, number]; zoom: number };

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Markers fade in as they are added, which is what carries the eye across the
 * zoom-12 handoff where clusters become pins. Opacity only: the icon's own
 * `transform` holds the teardrop rotation, so animating transform here would
 * unwind the shape. Reduced motion damps this globally.
 */
const MARKER_ENTER = "animation: ui-marker-in 180ms ease-out both;";

/**
 * One marker silhouette for the whole map. A cluster and a pin differ only by
 * fill and by whether they carry a count — previously clusters were blue/red
 * circles set in `system-ui` while pins were category-coloured teardrops, so a
 * zoom step read as a change of subject rather than a change of scale.
 *
 * Colours are theme tokens (`--surface-raised`, `--ink`, `--brand`,
 * `--warning`), so the icons follow the theme without being rebuilt on a flip.
 */
function markerHtml({
  fill,
  size,
  selected = false,
  label,
  urgent = false,
  dot,
  verified = false,
}: {
  fill: string;
  size: number;
  selected?: boolean;
  label?: string;
  urgent?: boolean;
  /** Category colour, drawn as a disc inside the pin. See `MapPinStatus`. */
  dot?: string;
  verified?: boolean;
}): string {
  const ring = selected
    ? `0 0 0 3px var(--ink), 0 0 0 7px color-mix(in oklab, ${fill} 45%, transparent), `
    : "";
  const count = label
    ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 ${
        size >= 48 ? 14 : 12
      }px/1 var(--font-app-sans);color:#fff;">${label}</span>`
    : "";
  // The category disc sits in the pin's optical centre, which is above the
  // midpoint because the silhouette tapers to a point at the bottom.
  const categoryDot = dot
    ? `<span style="position:absolute;left:50%;top:${Math.round(size * 0.38)}px;width:${Math.round(
        size * 0.31
      )}px;height:${Math.round(
        size * 0.31
      )}px;margin-left:-${Math.round(size * 0.155)}px;margin-top:-${Math.round(
        size * 0.155
      )}px;border-radius:9999px;background:${dot};box-shadow:0 0 0 1.5px color-mix(in oklab, var(--surface-raised) 80%, transparent);"></span>`
    : "";
  const flag = urgent
    ? `<span style="position:absolute;top:-1px;right:-1px;width:12px;height:12px;border-radius:9999px;background:var(--warning);border:2px solid var(--surface-raised);"></span>`
    : "";
  // Verified organisations carry a filled check-mark disc. Shape as well as
  // colour, so the distinction survives a monochrome or colour-blind reading.
  const check = verified
    ? `<span style="position:absolute;right:-3px;bottom:2px;width:14px;height:14px;border-radius:9999px;background:var(--success);border:2px solid var(--surface-raised);display:flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </span>`
    : "";
  return `<div style="position:relative;width:${size}px;height:${size}px;${MARKER_ENTER}">
    <div style="position:absolute;inset:0;background:${fill};border:3px solid var(--surface-raised);border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:${ring}0 2px 6px rgba(0,0,0,.35);"></div>
    ${count}${categoryDot}${flag}${check}
  </div>`;
}

/**
 * Icons are pure functions of (status, category, selected) and are built from
 * theme tokens, so one cache serves every marker and survives a theme flip
 * without a rebuild.
 */
// A plain record rather than a `Map`, because this module's own default export
// is named `Map` and shadows the global.
const ICON_CACHE: Record<string, L.DivIcon> = {};

function institutionIcon(
  status: MapPinStatus,
  category: string,
  selected: boolean
): L.DivIcon {
  const key = `${status}|${category}|${selected}`;
  const cached = ICON_CACHE[key];
  if (cached) return cached;

  const size = selected ? Math.round(32 * 1.35) : 32;
  const icon = L.divIcon({
    className: selected ? "dajsrce-pin dajsrce-pin-selected" : "dajsrce-pin",
    html: markerHtml({
      fill: PIN_STATUS_FILL[status],
      size,
      selected,
      dot: getCategoryConfig(category).color,
      verified: status === "verified",
    }),
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  });
  ICON_CACHE[key] = icon;
  return icon;
}

function clusterIconSize(count: number): number {
  return count >= 100 ? 48 : count >= 10 ? 42 : 36;
}

/**
 * A named cluster carries its place under the pin. The count alone said
 * "Grupa od 1090 ustanova" — true, and useless: the group was a cell of a grid
 * laid over whatever rectangle the browser happened to show, so it named
 * nothing a visitor could recognise or search for.
 *
 * The caption is drawn outside the icon box and centred on it, with
 * `overflow: visible` on the pane, so a long street name does not shift the
 * pin off its coordinate. It is `aria-hidden` because the marker's `alt`
 * already carries the same words as its accessible name.
 */
function clusterCaptionHtml(placeName: string, size: number): string {
  const escaped = placeName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<span aria-hidden="true" style="
    position:absolute;top:${size + 2}px;left:50%;transform:translateX(-50%);
    max-width:140px;padding:1px 6px;border-radius:6px;
    font:600 11px/1.35 var(--font-app-sans);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis;
    color:var(--ink);background:color-mix(in oklab, var(--surface-raised) 88%, transparent);
    box-shadow:0 1px 3px rgba(0,0,0,.28);pointer-events:none;
  ">${escaped}</span>`;
}

function createClusterIcon(
  count: number,
  urgent: boolean,
  placeName: string | null
): L.DivIcon {
  const size = clusterIconSize(count);
  const caption = placeName ? clusterCaptionHtml(placeName, size) : "";
  return L.divIcon({
    className: "dajsrce-pin dajsrce-cluster",
    html: `<div style="position:relative;width:${size}px;height:${size}px;">${markerHtml({
      fill: "var(--brand)",
      size,
      label: String(Math.max(1, Math.trunc(count))),
      urgent,
    })}${caption}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  });
}

function createUserLocationIcon(): L.DivIcon {
  return L.divIcon({
    className: "dajsrce-user-dot",
    html: `<div style="position:relative;width:18px;height:18px;${MARKER_ENTER}">
      <div style="
        position: absolute; inset: 0;
        background: var(--info);
        border: 3px solid var(--surface-raised);
        border-radius: 50%;
        box-shadow: 0 0 0 8px color-mix(in oklab, var(--info) 22%, transparent), 0 2px 6px rgba(0,0,0,0.4);
      "></div>
    </div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function currentViewport(map: L.Map): MapViewport {
  const bounds = map.getBounds();
  return {
    bbox: [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ],
    zoom: map.getZoom(),
  };
}

/**
 * Shared by the cluster markers and by the cluster rows in the results panel,
 * so activating a group behaves the same wherever it is activated from.
 *
 * `maxZoom` is a cap, not a floor: `fitBounds` still picks the zoom the group's
 * own extent needs, so a county-wide group drills down one step while a
 * city-block group lands past the zoom-12 clustering threshold immediately.
 */
export function fitFeatureBounds(map: L.Map, bounds: MapBounds) {
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const animate = !prefersReducedMotion();
  if (minLng === maxLng && minLat === maxLat) {
    // A single-point group cannot be fitted; step past the clustering threshold
    // so the tap actually reveals institutions instead of the same circle.
    map.setView([minLat, minLng], Math.min(Math.max(map.getZoom() + 3, 12), 16), {
      animate,
    });
    return;
  }
  map.fitBounds(
    [
      [minLat, minLng],
      [maxLat, maxLng],
    ],
    { maxZoom: 14, padding: [32, 32], animate }
  );
}

function MapViewportObserver({
  onChange,
}: {
  onChange: (viewport: MapViewport) => void;
}) {
  const map = useMapEvents({
    moveend() {
      onChange(currentViewport(map));
    },
    zoomend() {
      onChange(currentViewport(map));
    },
  });

  useEffect(() => {
    onChange(currentViewport(map));
  }, [map, onChange]);

  return null;
}

/**
 * Replaces Leaflet's stock zoom control, which was the only chrome on the
 * screen outside the design system: monospace glyphs, its own shadow, and 26px
 * targets against a 44px minimum.
 *
 * The z-index is deliberately a local one. This element lives inside the
 * Leaflet container's own stacking context (`z-0` plus `isolate` on the map
 * wrapper), where it only has to out-rank Leaflet's internal panes (≤ 700); it
 * never competes with the app-level ladder in globals.css.
 */
function MapZoomControl() {
  const t = useT();
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const containerRef = useRef<HTMLDivElement | null>(null);

  useMapEvents({
    zoomend() {
      setZoom(map.getZoom());
    },
  });

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    // What Leaflet's own controls do. A press here must not pan the map and a
    // double-tap must not zoom it; React's synthetic `stopPropagation` cannot
    // achieve that, because Leaflet listens natively on the container beneath.
    L.DomEvent.disableClickPropagation(node);
    L.DomEvent.disableScrollPropagation(node);
  }, []);

  const control =
    "inline-flex h-11 w-11 items-center justify-center text-ink transition-[background-color,color,transform] duration-150 ease-out hover:bg-surface-sunken motion-safe:active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-40";

  return (
    <div
      ref={containerRef}
      data-ui-material
      className="absolute right-3 top-3 z-[800] flex flex-col overflow-hidden rounded-control border border-border-subtle bg-chrome shadow-overlay backdrop-blur-md"
    >
      <button
        type="button"
        onClick={() => map.zoomIn()}
        disabled={zoom >= map.getMaxZoom()}
        aria-label={t("map_ui.zoom_in")}
        title={t("map_ui.zoom_in")}
        className={control}
      >
        <Plus className="h-5 w-5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => map.zoomOut()}
        disabled={zoom <= map.getMinZoom()}
        aria-label={t("map_ui.zoom_out")}
        title={t("map_ui.zoom_out")}
        className={`${control} border-t border-border-subtle`}
      >
        <Minus className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}

function MapFlyToSelection({
  selectedId,
  institutions,
}: {
  selectedId: string | null;
  institutions: PublicMapInstitution[];
}) {
  const map = useMap();
  // Data refetches hand us a fresh `institutions` array on every viewport change.
  // Remember which selection we already flew to so a refresh never re-centres the
  // map and traps the user on the selected marker.
  const flownSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedId) {
      flownSelectionRef.current = null;
      return;
    }
    if (flownSelectionRef.current === selectedId) return;
    const institution = institutions.find((item) => item.id === selectedId);
    // The selection can arrive before its feature does; stay pending until it lands.
    if (!institution) return;
    flownSelectionRef.current = selectedId;
    map.flyTo([institution.latitude, institution.longitude], Math.max(map.getZoom(), 14), {
      duration: 0.65,
      animate: !prefersReducedMotion(),
    });
  }, [selectedId, institutions, map]);

  return null;
}

function MapCommandRunner({ command }: { command: MapCommand | null }) {
  const map = useMap();
  const lastTokenRef = useRef(0);

  useEffect(() => {
    if (!command || command.token === lastTokenRef.current) return;
    lastTokenRef.current = command.token;
    if (command.kind === "zoom") {
      // Leaflet clamps against the container's own min/max zoom.
      map.setZoom(map.getZoom() + command.delta, {
        animate: !prefersReducedMotion(),
      });
      return;
    }
    if (command.kind === "flyTo") {
      map.flyTo(command.center, command.zoom, {
        duration: 0.85,
        animate: !prefersReducedMotion(),
      });
      return;
    }
    fitFeatureBounds(map, command.bounds);
  }, [command, map]);

  return null;
}

function ClusterMarker({ cluster }: { cluster: PublicMapCluster }) {
  const t = useT();
  const map = useMap();
  const icon = useMemo(
    () => createClusterIcon(cluster.count, cluster.hasUrgentNeed, cluster.placeName),
    [cluster.count, cluster.hasUrgentNeed, cluster.placeName]
  );
  // A named group says where it is; the grid fallback can only say how many.
  const label = cluster.placeName
    ? t("map_ui.cluster_place_alt", {
        place: cluster.placeName,
        count: cluster.count,
      })
    : t("map_ui.cluster_alt", { count: cluster.count });
  const hint = cluster.placeName
    ? t("map_ui.cluster_place_title", {
        place: cluster.placeName,
        count: cluster.count,
      })
    : t("map_ui.cluster_title", { count: cluster.count });

  return (
    <Marker
      position={[cluster.latitude, cluster.longitude]}
      icon={icon}
      // The accessible name stays on `alt`; the tooltip below is a hover
      // affordance only, so removing the native `title` costs nothing to a
      // screen reader.
      alt={label}
      eventHandlers={{ click: () => fitFeatureBounds(map, cluster.bounds) }}
    >
      {/* A styled Leaflet tooltip instead of the browser's native `title`
          bubble, so the hover hint matches the app's chrome. */}
      <Tooltip
        direction="top"
        offset={[0, -(clusterIconSize(cluster.count) + 6)]}
        opacity={1}
        className="dajsrce-tooltip"
      >
        {hint}
      </Tooltip>
    </Marker>
  );
}

function InstitutionLayer({
  institution,
  isSelected,
  onSelect,
}: {
  institution: PublicMapInstitution;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const category = getCategoryConfig(institution.category);
  const status = pinStatus(institution);
  const icon = institutionIcon(status, institution.category, isSelected);
  const position: [number, number] = [institution.latitude, institution.longitude];
  const categoryLabel = locale === "hr" ? category.labelHr : category.label;
  // Fill is a colour, so the same distinction has to reach a screen reader.
  const statusLabel = t(`map_ui.status_${status}`);
  const isApproximateRegistryLocation =
    institution.entityType === "registry" &&
    (institution.locationPrecision === "city" ||
      institution.locationPrecision === "county");

  // The only popup left on the map. A protected institution is drawn as a
  // coarse area rather than a point, and that needs explaining where it is
  // seen. Pin popups were removed: the same click opens the full detail, so
  // they were duplicate work in mismatched chrome.
  if (institution.isLocationHidden) {
    return (
      <Circle
        center={position}
        radius={2200}
        pathOptions={{
          color: PIN_STATUS_FILL[status],
          fillColor: category.color,
          fillOpacity: isSelected ? 0.32 : 0.18,
          weight: isSelected ? 4 : 2,
        }}
        eventHandlers={{ click: () => onSelect(institution.id) }}
      >
        <Popup>
          <div className="text-sm">
            <p className="font-semibold text-ink">{institution.name}</p>
            <p className="text-ink-secondary">
              {categoryLabel} · {statusLabel}
            </p>
            <p className="mt-2 text-xs text-ink-secondary">
              {t("map_ui.hidden_safety")}
            </p>
          </div>
        </Popup>
      </Circle>
    );
  }

  return (
    <Marker
      position={position}
      icon={icon}
      zIndexOffset={isSelected ? 1000 : 0}
      // The approximate-location caveat used to live in a popup; it rides along
      // with the marker's own accessible name now that the popup is gone.
      title={
        isApproximateRegistryLocation
          ? `${institution.name} — ${statusLabel} — ${t("map_ui.registry_approximate")}`
          : `${institution.name} — ${statusLabel}`
      }
      alt={`${institution.name}, ${categoryLabel}, ${statusLabel}`}
      eventHandlers={{ click: () => onSelect(institution.id) }}
    />
  );
}

export type MapProps = {
  features: PublicMapFeature[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onViewportChange: (viewport: MapViewport) => void;
  initialCenter: [number, number];
  initialZoom: number;
  userPosition?: { lat: number; lng: number } | null;
  /** Panel-driven moves; see `MapCommand`. */
  command?: MapCommand | null;
};

function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    setDark(root.classList.contains("dark"));
    const observer = new MutationObserver(() => {
      setDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

/**
 * True below `md`. Safe to branch on without a hydration flash, because this
 * module is only ever loaded on the client (`dynamic(…, { ssr: false })`).
 */
function useCompactViewport() {
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

export default function Map({
  features,
  selectedId,
  onSelect,
  onViewportChange,
  initialCenter,
  initialZoom,
  userPosition = null,
  command = null,
}: MapProps) {
  const t = useT();
  const dark = useDarkMode();
  const compact = useCompactViewport();
  // Icons are token-driven and cached by (status, category, selected), so a
  // theme flip no longer remounts the marker set — only the tile layer changes.
  const userIcon = useMemo(() => createUserLocationIcon(), []);
  const institutions = useMemo(
    () =>
      features.filter(
        (feature): feature is PublicMapInstitution => feature.kind === "institution"
      ),
    [features]
  );

  return (
    <MapContainer
      center={initialCenter}
      zoom={initialZoom}
      minZoom={6}
      maxZoom={19}
      maxBounds={[
        [40.5, 9.5],
        [49.5, 24.0],
      ]}
      maxBoundsViscosity={0.6}
      preferCanvas
      className="h-full w-full z-0"
      scrollWheelZoom
      zoomControl={false}
      attributionControl={false}
      aria-label={t("map_ui.map_aria")}
    >
      <TileLayer
        key={dark ? "dark" : "light"}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a> | Address points: <a href="https://geoportal.dgu.hr/services/atom/ad/xml">DGU INSPIRE Addresses</a> (2026-08-02)'
        url={dark ? DARK_TILES : LIGHT_TILES}
        subdomains="abcd"
      />
      {/* Attribution leaves the bottom corner on phones, where the results
          sheet peeks over it, and stays bottom-right on the desktop split. */}
      <AttributionControl position={compact ? "topleft" : "bottomright"} />
      <MapZoomControl />
      <MapViewportObserver onChange={onViewportChange} />
      <MapFlyToSelection selectedId={selectedId} institutions={institutions} />
      <MapCommandRunner command={command} />
      {userPosition ? (
        <Marker
          position={[userPosition.lat, userPosition.lng]}
          icon={userIcon}
          title={t("map_ui.your_location")}
          alt={t("map_ui.your_location")}
        />
      ) : null}
      {features.map((feature) => {
        if (feature.kind === "cluster") {
          return <ClusterMarker key={feature.id} cluster={feature} />;
        }
        return (
          <InstitutionLayer
            key={feature.id}
            institution={feature}
            isSelected={feature.id === selectedId}
            onSelect={onSelect}
          />
        );
      })}
    </MapContainer>
  );
}
