"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as LibreMap, Marker, AttributionControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PIN_STATUS_FILL, pinStatus, type MapBounds, type PublicMapFeature } from "@/lib/location-map";
import type { DonationType, InstitutionCategory } from "@/lib/types";
import { basemapStyle } from "@/lib/basemap";
import { getCategoryConfig } from "@/lib/constants";
import { markerHtml, clusterCaptionHtml } from "@/lib/map-marker-html";
import { hiddenArea, toMapZoom, toPublicZoom } from "@/lib/maplibre-geometry";
import { useLocale, useT } from "@/i18n/client";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
const DATA_ATTRIBUTION = 'Address points: <a href="https://geoportal.dgu.hr/services/atom/ad/xml">DGU INSPIRE Addresses</a> (2026-08-02)';
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

export type MapProps = {
  features: PublicMapFeature[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onViewportChange: (viewport: MapViewport) => void;
  initialCenter: [number, number];
  initialZoom: number;
  userPosition?: { lat: number; lng: number } | null;
  command?: MapCommand | null;
};

const duration = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650;

export function fitFeatureBounds(map: LibreMap, bounds: MapBounds) {
  const [west, south, east, north] = bounds;
  if (west === east && south === north) {
    map.easeTo({ center: [west, south], zoom: Math.min(Math.max(map.getZoom() + 3, 11), 15), duration: duration() });
  } else {
    map.fitBounds([[west, south], [east, north]], { maxZoom: 13, padding: 32, duration: duration() });
  }
}

export default function Map({ features, selectedId, onSelect, onViewportChange, initialCenter, initialZoom, userPosition = null, command = null }: MapProps) {
  const t = useT();
  const { locale } = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const appliedDark = useRef(false);
  const callbacks = useRef({ onSelect, onViewportChange });
  const initial = useRef({ center: initialCenter, zoom: initialZoom });
  const focusedMarker = useRef<string | null>(null);
  const flown = useRef<string | null>(null);
  const lastCommand = useRef(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(toMapZoom(initialZoom));
  const [dark, setDark] = useState(false);
  useEffect(() => { callbacks.current = { onSelect, onViewportChange }; }, [onSelect, onViewportChange]);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!container.current) return;
    let map: LibreMap;
    appliedDark.current = document.documentElement.classList.contains("dark");
    try {
      map = new LibreMap({
        container: container.current,
        style: basemapStyle(appliedDark.current),
        center: [initial.current.center[1], initial.current.center[0]], zoom: toMapZoom(initial.current.zoom),
        minZoom: 5, maxZoom: 18, maxBounds: [[9.5, 40.5], [24, 49.5]],
        attributionControl: false, dragRotate: false, pitchWithRotate: false, renderWorldCopies: false,
      });
    } catch { setFailed(true); return; }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    const compact = window.matchMedia("(max-width: 767px)");
    const attribution = new AttributionControl({ compact: true, customAttribution: DATA_ATTRIBUTION });
    const positionAttribution = () => {
      if (map.hasControl(attribution)) map.removeControl(attribution);
      map.addControl(attribution, compact.matches ? "top-left" : "bottom-right");
    };
    positionAttribution();
    compact.addEventListener("change", positionAttribution);
    const emit = () => {
      const bounds = map.getBounds();
      setZoom(map.getZoom());
      callbacks.current.onViewportChange({ bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], zoom: toPublicZoom(map.getZoom()) });
    };
    // List discovery must not wait for third-party tile downloads.
    map.once("style.load", emit);
    map.once("load", () => setReady(true));
    map.on("moveend", emit);
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    return () => {
      resize.disconnect(); compact.removeEventListener("change", positionAttribution);
      map.remove(); mapRef.current = null; setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && appliedDark.current !== dark) {
      appliedDark.current = dark;
      map.setStyle(basemapStyle(dark));
    }
  }, [dark, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const localize = () => {
      for (const layer of map.getStyle()?.layers ?? []) {
        if (layer.type !== "symbol" || !JSON.stringify(layer.layout?.["text-field"] ?? "").includes('"name')) continue;
        map.setLayoutProperty(layer.id, "text-field", locale === "hr"
          ? ["coalesce", ["get", "name:hr"], ["get", "name:latin"], ["get", "name"]]
          : ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name:latin"], ["get", "name"]]);
      }
    };
    localize();
    map.on("style.load", localize);
    return () => { map.off("style.load", localize); };
  }, [locale, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getCanvas().setAttribute("aria-label", t("map_ui.map_aria"));
    const markers: Marker[] = [];
    for (const feature of features) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.featureId = feature.id;
      button.className = "dajsrce-marker";
      let label: string;
      if (feature.kind === "cluster") {
        const size = feature.count >= 100 ? 48 : feature.count >= 10 ? 42 : 36;
        label = feature.placeName ? t("map_ui.cluster_place_alt", { place: feature.placeName, count: feature.count }) : t("map_ui.cluster_alt", { count: feature.count });
        button.innerHTML = markerHtml({ fill: "var(--brand)", size, label: String(Math.max(1, Math.trunc(feature.count))), urgent: feature.hasUrgentNeed }) + (feature.placeName ? clusterCaptionHtml(feature.placeName, size) : "");
        button.addEventListener("click", (event) => { event.stopPropagation(); fitFeatureBounds(map, feature.bounds); });
      } else {
        const status = pinStatus(feature);
        const category = getCategoryConfig(feature.category);
        label = `${feature.name}, ${locale === "hr" ? category.labelHr : category.label}, ${t(`map_ui.status_${status}`)}`;
        if (feature.isLocationHidden) {
          // Area geometry is the visible location. This focusable area label
          // provides the equivalent selection action to keyboard users.
          label += `, ${t("map_ui.hidden_safety")}`;
          button.classList.add("dajsrce-area-label");
          button.textContent = "≈";
        } else {
          const selected = feature.id === selectedId;
          button.innerHTML = markerHtml({ fill: PIN_STATUS_FILL[status], size: selected ? 43 : 32, selected, verified: status === "verified" });
          if (feature.locationPrecision === "city" || feature.locationPrecision === "county") label += `, ${t("map_ui.registry_approximate")}`;
        }
        button.style.zIndex = feature.id === selectedId ? "10" : "0";
        button.addEventListener("click", (event) => { event.stopPropagation(); callbacks.current.onSelect(feature.id); });
      }
      button.setAttribute("aria-label", label);
      button.title = label;
      markers.push(new Marker({ element: button, anchor: feature.kind === "institution" && feature.isLocationHidden ? "center" : "bottom" }).setLngLat([feature.longitude, feature.latitude]).addTo(map));
    }
    const restore = markers.find((marker) => marker.getElement().dataset.featureId === focusedMarker.current);
    restore?.getElement().focus({ preventScroll: true });
    focusedMarker.current = null;
    return () => {
      const active = document.activeElement as HTMLElement | null;
      focusedMarker.current = active?.dataset.featureId ?? null;
      markers.forEach((marker) => marker.remove());
    };
  }, [features, selectedId, locale, t, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const syncAreas = () => {
      if (!map.getSource("openmaptiles")) return;
      const tokens = getComputedStyle(document.documentElement);
      const areas = features.filter((f) => f.kind === "institution" && f.isLocationHidden).map((f) => {
        if (f.kind !== "institution") throw new Error("Unexpected cluster");
        const fill = PIN_STATUS_FILL[pinStatus(f)];
        const color = fill.startsWith("var(") ? tokens.getPropertyValue(fill.slice(4, -1)).trim() : fill;
        return hiddenArea(f, color, f.id === selectedId);
      });
      const data = { type: "FeatureCollection" as const, features: areas };
      const source = map.getSource<GeoJSONSource>("hidden-areas");
      if (source) { source.setData(data); return; }
      map.addSource("hidden-areas", { type: "geojson", data });
      map.addLayer({ id: "hidden-area-fill", type: "fill", source: "hidden-areas", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "selected"], 0.32, 0.18] } });
      map.addLayer({ id: "hidden-area-outline", type: "line", source: "hidden-areas", paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "selected"], 4, 2] } });
    };
    const selectArea = (event: { features?: { properties: Record<string, unknown> }[] }) => {
      const id = event.features?.[0]?.properties.id;
      if (typeof id === "string") callbacks.current.onSelect(id);
    };
    syncAreas();
    const onStyleLoad = () => syncAreas();
    map.on("style.load", onStyleLoad);
    map.on("click", "hidden-area-fill", selectArea);
    return () => { map.off("style.load", onStyleLoad); map.off("click", "hidden-area-fill", selectArea); };
  }, [features, selectedId, dark, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !userPosition) return;
    const element = document.createElement("div");
    element.className = "dajsrce-user-dot";
    element.setAttribute("role", "img"); element.setAttribute("aria-label", t("map_ui.your_location"));
    const marker = new Marker({ element }).setLngLat([userPosition.lng, userPosition.lat]).addTo(map);
    return () => { marker.remove(); };
  }, [userPosition, ready, t]);

  useEffect(() => {
    const map = mapRef.current;
    if (!selectedId) { flown.current = null; return; }
    if (!map || !ready || flown.current === selectedId) return;
    const feature = features.find((f) => f.kind === "institution" && f.id === selectedId);
    if (!feature) return;
    flown.current = selectedId;
    map.easeTo({ center: [feature.longitude, feature.latitude], zoom: Math.max(map.getZoom(), 13), duration: duration() });
  }, [selectedId, features, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !command || lastCommand.current === command.token) return;
    lastCommand.current = command.token;
    if (command.kind === "fitBounds") fitFeatureBounds(map, command.bounds);
    else if (command.kind === "zoom") map.easeTo({ zoom: Math.max(5, Math.min(18, map.getZoom() + command.delta)), duration: duration() });
    else map.easeTo({ center: [command.center[1], command.center[0]], zoom: toMapZoom(command.zoom), duration: duration() });
  }, [command, ready]);

  const control = "inline-flex h-11 w-11 items-center justify-center text-ink hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-40";
  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" aria-label={t("map_ui.map_aria")} />
      {failed ? <p role="alert" className="absolute inset-0 flex items-center justify-center bg-surface p-6 text-center text-ink">{t("map_ui.webgl_unavailable")}</p> : (
        <div data-ui-material className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-control border border-border-subtle bg-chrome shadow-overlay backdrop-blur-md">
          <button type="button" className={control} aria-label={t("map_ui.zoom_in")} disabled={!ready || zoom >= 18} onClick={() => mapRef.current?.zoomIn({ duration: duration() })}><Plus className="h-5 w-5" aria-hidden /></button>
          <button type="button" className={`${control} border-t border-border-subtle`} aria-label={t("map_ui.zoom_out")} disabled={!ready || zoom <= 5} onClick={() => mapRef.current?.zoomOut({ duration: duration() })}><Minus className="h-5 w-5" aria-hidden /></button>
        </div>
      )}
    </div>
  );
}
