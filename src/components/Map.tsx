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
import { Info, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
import { basemapLayer, normalizeCartoApiKey } from "@/lib/basemap";
import { getCategoryConfig } from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";
import { pluralKey } from "@/i18n/dictionaries";
import {
  PIN_LABEL_GAP,
  PIN_LABEL_HEIGHT,
  planPinLabels,
  type ScreenBox,
} from "@/lib/pin-labels";
import type { Locale } from "@/lib/types";

/**
 * Public by nature (it travels in every tile URL), so it is a NEXT_PUBLIC_
 * value. The static reference is what lets Next inline it into the client
 * bundle; see `src/lib/basemap.ts` for what happens when it is absent.
 */
const CARTO_API_KEY = normalizeCartoApiKey(process.env.NEXT_PUBLIC_CARTO_API_KEY);

const DGU_ADDRESSES_URL = "https://geoportal.dgu.hr/services/atom/ad/xml";
/** The DGU address-point extract the register geocodes were matched against. */
const DGU_ADDRESSES_DATE = new Date(Date.UTC(2026, 7, 2));

/**
 * The address-point credit in the reader's language. Leaflet renders the
 * attribution as HTML, so the markup is built here from dictionary text.
 */
function dataAttribution(
  t: (key: string, vars?: Record<string, string | number>) => string,
  locale: Locale
): string {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    DGU_ADDRESSES_DATE
  );
  return t("map_ui.data_attribution", {
    source: `<a href="${DGU_ADDRESSES_URL}" target="_blank" rel="noopener noreferrer">${t("map_ui.data_attribution_source")}</a>`,
    date,
  });
}

export interface MapFilters {
  categories: InstitutionCategory[];
  donationTypes: DonationType[];
  /** Exact city name from the register's own list, or null for everywhere. */
  city: string | null;
  onlyZagreb: boolean;
  onlyUrgent: boolean;
  /** Narrow to organisations that hold an account here. Server-side. */
  onlyOnboarded: boolean;
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
  /** A group activated in the results panel: one level down, never out. */
  | { token: number; kind: "drill"; bounds: MapBounds }
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
 * fill and by whether they carry a count, previously clusters were blue/red
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
  verified = false,
}: {
  fill: string;
  size: number;
  selected?: boolean;
  label?: string;
  urgent?: boolean;
  verified?: boolean;
}): string {
  const ring = selected
    ? `0 0 0 3px var(--ink), 0 0 0 7px color-mix(in oklab, ${fill} 45%, transparent), `
    : "";
  // A grouped count ("10.172") steps down a size so it stays inside the pin.
  const count = label
    ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 ${
        size >= 48 && label.length <= 5 ? 14 : label.length > 5 ? 11 : 12
      }px/1 var(--font-app-sans);color:#fff;">${label}</span>`
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
    ${count}${flag}${check}
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

function institutionIcon(status: MapPinStatus, selected: boolean): L.DivIcon {
  const key = `${status}|${selected}`;
  const cached = ICON_CACHE[key];
  if (cached) return cached;

  const size = selected ? PIN_SELECTED_SIZE : PIN_SIZE;
  const icon = L.divIcon({
    className: selected ? "dajsrce-pin dajsrce-pin-selected" : "dajsrce-pin",
    html: markerHtml({
      fill: PIN_STATUS_FILL[status],
      size,
      selected,
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
 * "Grupa od 1090 ustanova", true, and useless: the group was a cell of a grid
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
  placeName: string | null,
  locale: Locale
): L.DivIcon {
  const size = clusterIconSize(count);
  const caption = placeName ? clusterCaptionHtml(placeName, size) : "";
  return L.divIcon({
    className: "dajsrce-pin dajsrce-cluster",
    html: `<div style="position:relative;width:${size}px;height:${size}px;">${markerHtml({
      fill: "var(--brand)",
      size,
      label: Math.max(1, Math.trunc(count)).toLocaleString(locale),
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
 * The deepest zoom a group tap goes to. Past it the server returns single
 * pins for any viewport (at most a handful of organisations share one
 * address), so there is no further level to drill into.
 */
const CLUSTER_DRILL_MAX_ZOOM = 18;

/**
 * Fits the map around a set of results (a fresh search or filter). Unlike a
 * group tap this may zoom out: the answer can cover the whole country.
 */
export function fitFeatureBounds(map: L.Map, bounds: MapBounds) {
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const animate = !prefersReducedMotion();
  if (minLng === maxLng && minLat === maxLat) {
    map.setView([minLat, minLng], Math.max(map.getZoom(), 12), { animate });
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

/**
 * Opens a group one level down. Shared by the cluster markers and by the
 * cluster rows in the results panel, so activating a group behaves the same
 * wherever it is activated from.
 *
 * Never zooms out: zooming out is the visitor's own move (wheel, pinch or the
 * buttons). The old version reused `fitBounds` with a cap of 14, so a group
 * tapped at zoom 15 or deeper, or one whose extent was wider than the screen,
 * pulled the map back out.
 *
 * The map lands on the group's own extent, which is what makes the server pick
 * the next tier down (county → city → district → street → pins): a tier wins
 * only if it splits the viewport, and the viewport is now that one group.
 * Every tap goes at least one zoom level deeper. The old `fitBounds` cap of
 * 14 turned a street group seen at zoom 14 into a dead end, the same pin
 * redrawn after every tap.
 */
export function drillIntoCluster(map: L.Map, bounds: MapBounds) {
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const animate = !prefersReducedMotion();
  // Mid-animation `getZoom()` is still the old level; the target is what a
  // second quick tap has to build on, or it would undo the first one.
  const current = Math.max(map.getZoom(), drillTargetZoom.get(map) ?? 0);
  const ceiling = Math.min(CLUSTER_DRILL_MAX_ZOOM, map.getMaxZoom());
  if (minLng === maxLng && minLat === maxLat) {
    // A single-point group cannot be fitted; step past the clustering threshold
    // so the tap actually reveals institutions instead of the same circle.
    map.setView([minLat, minLng], Math.min(Math.max(current + 3, 12), ceiling), {
      animate,
    });
    return;
  }
  const extent = L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
  const fitted = map.getBoundsZoom(extent, false, L.point(64, 64));
  const target = Math.min(Math.max(fitted, current + 1), ceiling);
  const next = Math.max(target, current);
  drillTargetZoom.set(map, next);
  map.once("zoomend moveend", () => drillTargetZoom.delete(map));
  map.setView(extent.getCenter(), next, { animate });
}

const drillTargetZoom = new WeakMap<L.Map, number>();

/**
 * Name labels over single pins, placed only where they read cleanly.
 *
 * Density is judged on screen, where crowding is actually felt, not per square
 * kilometre: a label is drawn only if its box clears every other pin and every
 * label already placed, and only if its pin has few neighbours close by (a
 * label that fits between pins in a tight cluster still reads as noise).
 * Placement is greedy in priority order, so the selected organisation and
 * then the ones with an account win the space. Below `PIN_LABEL_MIN_ZOOM`
 * nothing is labelled: the pins are towns apart and the panel names them.
 */
const PIN_LABEL_MIN_ZOOM = 12;
const PIN_SIZE = 32;
const PIN_SELECTED_SIZE = Math.round(32 * 1.35);
const PIN_LABEL_MAX_WIDTH = 168;
const PIN_LABEL_MAX_WIDTH_COMPACT = 132;
/** Label padding plus border, left and right. */
const PIN_LABEL_CHROME = 16;
/** Bounded so a long session of panning cannot grow it without limit. */
const LABEL_WIDTH_CACHE = new globalThis.Map<string, number>();

function labelPriority(institution: PublicMapInstitution, selectedId: string | null): number {
  if (institution.id === selectedId) return 0;
  const status = pinStatus(institution);
  if (status === "verified") return 1;
  if (status === "onboarded") return 2;
  return institution.hasUrgentNeed ? 3 : 4;
}

function measureLabelWidth(
  context: CanvasRenderingContext2D | null,
  font: string,
  name: string,
  maxWidth: number
): number {
  const key = `${font}|${name}`;
  let text = LABEL_WIDTH_CACHE.get(key);
  if (text === undefined) {
    // Without a canvas, a generous per-character estimate errs towards fewer labels.
    text = context ? context.measureText(name).width : name.length * 6.5;
    if (LABEL_WIDTH_CACHE.size > 2000) LABEL_WIDTH_CACHE.clear();
    LABEL_WIDTH_CACHE.set(key, text);
  }
  return Math.min(Math.ceil(text) + PIN_LABEL_CHROME, maxWidth);
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * The floating controls over the map, in container coordinates, so a label is
 * never drawn underneath one. Both Leaflet's own controls and the page's
 * glass chrome (`data-ui-material`) count.
 */
function mapChromeBoxes(map: L.Map): ScreenBox[] {
  const container = map.getContainer();
  const frame = container.getBoundingClientRect();
  // The page's buttons are siblings of the map, inside its positioned wrapper.
  const scope = container.offsetParent ?? container;
  const boxes: ScreenBox[] = [];
  for (const element of scope.querySelectorAll<HTMLElement>("[data-ui-material], .leaflet-control")) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right < frame.left || rect.left > frame.right) continue;
    if (rect.bottom < frame.top || rect.top > frame.bottom) continue;
    boxes.push({
      left: rect.left - frame.left,
      top: rect.top - frame.top,
      right: rect.right - frame.left,
      bottom: rect.bottom - frame.top,
    });
  }
  return boxes;
}

function PinLabelPlanner({
  institutions,
  selectedId,
  compact,
  onChange,
}: {
  institutions: PublicMapInstitution[];
  selectedId: string | null;
  compact: boolean;
  onChange: (ids: ReadonlySet<string>) => void;
}) {
  const map = useMap();
  const [revision, setRevision] = useState(0);
  const lastRef = useRef<ReadonlySet<string>>(new Set());
  const canvasRef = useRef<CanvasRenderingContext2D | null>(null);

  useMapEvents({
    zoomend: () => setRevision((value) => value + 1),
    moveend: () => setRevision((value) => value + 1),
    resize: () => setRevision((value) => value + 1),
  });

  useEffect(() => {
    let next: Set<string> = new Set();
    if (map.getZoom() >= PIN_LABEL_MIN_ZOOM && institutions.length > 0) {
      const size = map.getSize();
      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas").getContext("2d");
      }
      const context = canvasRef.current;
      const family =
        getComputedStyle(map.getContainer()).getPropertyValue("--font-app-sans").trim() ||
        "system-ui, sans-serif";
      const font = `600 11px ${family}`;
      if (context) context.font = font;
      const maxWidth = compact ? PIN_LABEL_MAX_WIDTH_COMPACT : PIN_LABEL_MAX_WIDTH;
      const pins = [];
      for (const institution of institutions) {
        // Protected organisations are drawn as an area, not a pin, and say
        // what they are in their own popup.
        if (institution.isLocationHidden) continue;
        const point = map.latLngToContainerPoint([institution.latitude, institution.longitude]);
        // Pins just off screen still count as obstacles for labels at the edge.
        if (
          point.x < -PIN_LABEL_MAX_WIDTH ||
          point.y < -PIN_SIZE ||
          point.x > size.x + PIN_LABEL_MAX_WIDTH ||
          point.y > size.y + PIN_LABEL_HEIGHT + PIN_SIZE
        ) {
          continue;
        }
        pins.push({
          id: institution.id,
          x: point.x,
          y: point.y,
          size: institution.id === selectedId ? PIN_SELECTED_SIZE : PIN_SIZE,
          priority: labelPriority(institution, selectedId),
          labelWidth: measureLabelWidth(context, font, institution.name, maxWidth),
        });
      }
      next = planPinLabels(pins, { width: size.x, height: size.y }, mapChromeBoxes(map));
    }
    if (sameIds(next, lastRef.current)) return;
    lastRef.current = next;
    onChange(next);
  }, [map, institutions, selectedId, compact, revision, onChange]);

  return null;
}

/**
 * `aria-label` on `MapContainer` became a Leaflet option and never reached
 * the DOM (react-leaflet forwards only `className`, `id` and `style`), so the
 * focusable map container had no name. It is named here once Leaflet owns it.
 */
function MapAccessibleName({ label }: { label: string }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", label);
  }, [map, label]);

  return null;
}

/**
 * Leaflet makes every marker icon `tabindex=0 role=button`, but Enter only
 * acts on a layer with a bound popup, and these markers have none: a keyboard
 * user tabbed onto buttons that did nothing. Enter and Space now do what a
 * click does.
 */
function activateOnKey(action: () => void) {
  return (event: L.LeafletKeyboardEvent) => {
    const { key } = event.originalEvent;
    if (key !== "Enter" && key !== " ") return;
    event.originalEvent.preventDefault();
    action();
  };
}

/**
 * The markers are `divIcon`s, and Leaflet applies `alt` only to an `<img>`
 * icon, so a cluster's accessible name was its bare digits. The name goes on
 * the icon element itself, re-applied whenever the icon is rebuilt.
 */
function useMarkerName(markerRef: RefObject<L.Marker | null>, name: string, icon: L.DivIcon) {
  useEffect(() => {
    markerRef.current?.getElement()?.setAttribute("aria-label", name);
  }, [markerRef, name, icon]);
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

/**
 * Phones: the attribution folds behind a small "i" in the top-left corner,
 * which OpenStreetMap's attribution guidelines allow on small screens. Open,
 * it is Leaflet's own control, so the credited text is exactly the desktop's.
 */
function CompactAttribution() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const node = buttonRef.current;
    if (!node) return;
    L.DomEvent.disableClickPropagation(node);
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t("map_ui.attribution")}
        title={t("map_ui.attribution")}
        className="absolute left-2 top-2 z-[800] inline-flex h-7 w-7 items-center justify-center rounded-full border border-border-subtle bg-chrome text-ink-secondary shadow-overlay backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>
      {open ? <AttributionControl position="topleft" /> : null}
    </>
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
    if (command.kind === "drill") {
      drillIntoCluster(map, command.bounds);
      return;
    }
    fitFeatureBounds(map, command.bounds);
  }, [command, map]);

  return null;
}

/** A real hovering pointer (mouse or trackpad), not a touch screen. */
function useCanHover() {
  const [canHover, setCanHover] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setCanHover(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return canHover;
}

function ClusterMarker({
  cluster,
  showCaption,
}: {
  cluster: PublicMapCluster;
  /**
   * Draw the place name under the count. Off on phones, where dozens of
   * captions overlap into an unreadable layer; the sheet lists the same
   * names, and the tooltip and accessible name still carry them.
   */
  showCaption: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const map = useMap();
  const icon = useMemo(
    () =>
      createClusterIcon(
        cluster.count,
        cluster.hasUrgentNeed,
        showCaption ? cluster.placeName : null,
        locale
      ),
    [cluster.count, cluster.hasUrgentNeed, cluster.placeName, showCaption, locale]
  );
  const count = cluster.count.toLocaleString(locale);
  // A named group says where it is; the grid fallback can only say how many.
  const label = cluster.placeName
    ? t(pluralKey("map_ui.cluster_place_alt", locale, cluster.count), {
        place: cluster.placeName,
        count,
      })
    : t(pluralKey("map_ui.cluster_alt", locale, cluster.count), { count });
  const hint = cluster.placeName
    ? t(pluralKey("map_ui.cluster_place_title", locale, cluster.count), {
        place: cluster.placeName,
        count,
      })
    : t(pluralKey("map_ui.cluster_title", locale, cluster.count), { count });
  const markerRef = useRef<L.Marker | null>(null);
  useMarkerName(markerRef, label, icon);
  const focusCluster = () => drillIntoCluster(map, cluster.bounds);
  const canHover = useCanHover();

  return (
    <Marker
      ref={markerRef}
      position={[cluster.latitude, cluster.longitude]}
      icon={icon}
      // The accessible name is set by `useMarkerName`; the tooltip below is a
      // hover affordance only, so removing the native `title` costs nothing
      // to a screen reader.
      eventHandlers={{ click: focusCluster, keydown: activateOnKey(focusCluster) }}
    >
      {/* A styled Leaflet tooltip instead of the browser's native `title`
          bubble, so the hover hint matches the app's chrome. Mouse only: on a
          touch screen Leaflet opens it from the emulated mouseover, and iOS
          Safari treats a tap that changes the page on hover as a hover alone
          and swallows the click, so the first tap showed the hint and only a
          second tap zoomed. */}
      {canHover ? (
        <Tooltip
          direction="top"
          offset={[0, -(clusterIconSize(cluster.count) + 6)]}
          opacity={1}
          className="dajsrce-tooltip"
        >
          {hint}
        </Tooltip>
      ) : null}
    </Marker>
  );
}

function InstitutionLayer({
  institution,
  isSelected,
  showLabel,
  onSelect,
}: {
  institution: PublicMapInstitution;
  isSelected: boolean;
  /** Decided by `PinLabelPlanner` from the on-screen crowding. */
  showLabel: boolean;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const category = getCategoryConfig(institution.category);
  const status = pinStatus(institution);
  const icon = institutionIcon(status, isSelected);
  const position: [number, number] = [institution.latitude, institution.longitude];
  const categoryLabel = locale === "hr" ? category.labelHr : category.label;
  // Fill is a colour, so the same distinction has to reach a screen reader.
  const statusLabel = t(`map_ui.status_${status}`);
  const isApproximateRegistryLocation =
    institution.entityType === "registry" &&
    (institution.locationPrecision === "city" ||
      institution.locationPrecision === "county");
  // The approximate-location caveat used to live in a popup; it rides along
  // with the marker's own accessible name now that the popup is gone.
  const accessibleName = isApproximateRegistryLocation
    ? `${institution.name}, ${categoryLabel}, ${statusLabel}, ${t("map_ui.registry_approximate")}`
    : `${institution.name}, ${categoryLabel}, ${statusLabel}`;
  const markerRef = useRef<L.Marker | null>(null);
  useMarkerName(markerRef, accessibleName, icon);

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
          fillColor: PIN_STATUS_FILL[status],
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

  const select = () => onSelect(institution.id);

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={icon}
      zIndexOffset={isSelected ? 1000 : 0}
      title={
        isApproximateRegistryLocation
          ? `${institution.name}, ${statusLabel}, ${t("map_ui.registry_approximate")}`
          : `${institution.name}, ${statusLabel}`
      }
      eventHandlers={{ click: select, keydown: activateOnKey(select) }}
    >
      {showLabel ? (
        // Visual only: the marker's accessible name already starts with the
        // same organisation name.
        <Tooltip
          permanent
          direction="top"
          offset={[0, -((isSelected ? PIN_SELECTED_SIZE : PIN_SIZE) + PIN_LABEL_GAP)]}
          opacity={1}
          className="dajsrce-pin-label"
        >
          <span aria-hidden="true">{institution.name}</span>
        </Tooltip>
      ) : null}
    </Marker>
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
  const { locale } = useLocale();
  const dark = useDarkMode();
  const basemap = useMemo(() => basemapLayer(dark, CARTO_API_KEY), [dark]);
  const compact = useCompactViewport();
  // Icons are token-driven and cached by (status, category, selected), so a
  // theme flip no longer remounts the marker set; only the tile layer changes.
  const userIcon = useMemo(() => createUserLocationIcon(), []);
  const institutions = useMemo(
    () =>
      features.filter(
        (feature): feature is PublicMapInstitution => feature.kind === "institution"
      ),
    [features]
  );
  const [labelledIds, setLabelledIds] = useState<ReadonlySet<string>>(() => new Set());

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
    >
      <MapAccessibleName label={t("map_ui.map_aria")} />
      {/* Leaflet reads the attribution when the layer is created, so the
          locale is part of the key: switching language rebuilds the credit. */}
      <TileLayer
        key={`${basemap.provider}:${dark ? "dark" : "light"}:${locale}`}
        attribution={`${basemap.attribution} | ${dataAttribution(t, locale)}`}
        url={basemap.url}
        subdomains={basemap.subdomains}
        className={basemap.className}
        maxZoom={basemap.maxZoom}
      />
      {/* Attribution leaves the bottom corner on phones, where the results
          sheet peeks over it, and stays bottom-right on the desktop split. */}
      {compact ? <CompactAttribution /> : <AttributionControl position="bottomright" />}
      <MapZoomControl />
      <MapViewportObserver onChange={onViewportChange} />
      <MapFlyToSelection selectedId={selectedId} institutions={institutions} />
      <MapCommandRunner command={command} />
      <PinLabelPlanner
        institutions={institutions}
        selectedId={selectedId}
        compact={compact}
        onChange={setLabelledIds}
      />
      {userPosition ? (
        // Informational only: nothing happens on activation, so it is not a
        // keyboard stop.
        <Marker
          position={[userPosition.lat, userPosition.lng]}
          icon={userIcon}
          title={t("map_ui.your_location")}
          keyboard={false}
        />
      ) : null}
      {features.map((feature) => {
        if (feature.kind === "cluster") {
          return <ClusterMarker key={feature.id} cluster={feature} showCaption={!compact} />;
        }
        return (
          <InstitutionLayer
            key={feature.id}
            institution={feature}
            isSelected={feature.id === selectedId}
            showLabel={labelledIds.has(feature.id)}
            onSelect={onSelect}
          />
        );
      })}
    </MapContainer>
  );
}
