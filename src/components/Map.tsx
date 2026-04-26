"use client";

import "leaflet/dist/leaflet.css";

import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import type { Institution, InstitutionCategory, DonationType } from "@/lib/types";
import { CATEGORY_CONFIG, ZAGREB_CENTER, DEFAULT_ZOOM, getCategoryConfig, FALLBACK_CATEGORY_CONFIG } from "@/lib/constants";

const LIGHT_TILES = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const DARK_TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

export interface MapFilters {
  categories: InstitutionCategory[];
  donationType: DonationType | null;
  onlyZagreb: boolean;
  onlyUrgent: boolean;
}

export function createCategoryIcon(color: string, size: number = 32, dark = false): L.DivIcon {
  const border = dark ? "#1f2937" : "white";
  return L.divIcon({
    className: "",
    html: `<div style="
      width: ${size}px; height: ${size}px;
      background: ${color};
      border: 3px solid ${border};
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      box-shadow: 0 2px 6px rgba(0,0,0,${dark ? "0.6" : "0.3"});
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

function createUserLocationIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="position: relative; width: 18px; height: 18px;">
      <div style="
        position: absolute; inset: 0;
        background: #3b82f6;
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 0 0 8px rgba(59,130,246,0.20), 0 2px 6px rgba(0,0,0,0.4);
      "></div>
    </div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function buildIcons(dark: boolean) {
  const icons = {} as Record<string, L.DivIcon>;
  for (const key of Object.keys(CATEGORY_CONFIG) as InstitutionCategory[]) {
    icons[key] = createCategoryIcon(CATEGORY_CONFIG[key].color, 32, dark);
  }
  // Fallback icon for any unknown category that may arrive from the DB.
  icons["__fallback__"] = createCategoryIcon(FALLBACK_CATEGORY_CONFIG.color, 32, dark);
  return icons;
}

const HIDDEN_CIRCLE_RADIUS_M = 650;

function isZagrebCity(city: string): boolean {
  const n = city.trim().toLowerCase();
  return n === "zagreb" || n.startsWith("zagreb ");
}

function passesFilters(inst: Institution, filters: MapFilters): boolean {
  if (filters.categories.length > 0 && !filters.categories.includes(inst.category)) {
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
  // filters.onlyUrgent: no urgency on Institution — pass a pre-filtered `institutions` list from the parent.
  return true;
}

function MapFlyToSelection({
  selectedId,
  institutions,
}: {
  selectedId: string | null;
  institutions: Institution[];
}) {
  const map = useMap();

  useEffect(() => {
    if (!selectedId) return;
    const inst = institutions.find((i) => i.id === selectedId);
    if (!inst) return;
    map.flyTo([inst.lat, inst.lng], 15, { duration: 0.75 });
  }, [selectedId, institutions, map]);

  return null;
}

function MapFlyToUser({
  userPosition,
  flyTrigger,
}: {
  userPosition: { lat: number; lng: number } | null;
  flyTrigger: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!userPosition || flyTrigger === 0) return;
    map.flyTo([userPosition.lat, userPosition.lng], 14, { duration: 0.85 });
    // flyTrigger increments on each Locate click so repeat clicks re-center
    // even if userPosition coordinates haven't changed.
  }, [userPosition, flyTrigger, map]);

  return null;
}

export type MapProps = {
  institutions: Institution[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filters: MapFilters;
  userPosition?: { lat: number; lng: number } | null;
  flyToUserTrigger?: number;
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

export default function Map({
  institutions,
  selectedId,
  onSelect,
  filters,
  userPosition = null,
  flyToUserTrigger = 0,
}: MapProps) {
  const dark = useDarkMode();
  const icons = useMemo(() => buildIcons(dark), [dark]);
  const userIcon = useMemo(() => createUserLocationIcon(), []);

  const visible = useMemo(
    () => institutions.filter((i) => passesFilters(i, filters)),
    [institutions, filters],
  );

  return (
    <MapContainer
      center={ZAGREB_CENTER}
      zoom={DEFAULT_ZOOM}
      className="h-full w-full z-0"
      scrollWheelZoom
    >
      <TileLayer
        key={dark ? "dark" : "light"}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url={dark ? DARK_TILES : LIGHT_TILES}
        subdomains="abcd"
      />
      <MapFlyToSelection selectedId={selectedId} institutions={institutions} />
      <MapFlyToUser userPosition={userPosition} flyTrigger={flyToUserTrigger} />
      {userPosition ? (
        <Marker position={[userPosition.lat, userPosition.lng]} icon={userIcon}>
          <Popup>
            <div className="text-sm font-semibold">Your location</div>
          </Popup>
        </Marker>
      ) : null}
      {visible.map((inst) => {
        const cat = getCategoryConfig(inst.category);
        const icon = icons[inst.category] ?? icons["__fallback__"];

        if (inst.is_location_hidden) {
          const fill = cat.color;
          return (
            <Circle
              key={inst.id}
              center={[inst.lat, inst.lng]}
              radius={HIDDEN_CIRCLE_RADIUS_M}
              pathOptions={{
                color: fill,
                fillColor: fill,
                fillOpacity: 0.22,
                weight: 2,
              }}
              eventHandlers={{
                click: () => onSelect(inst.id),
              }}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold">{inst.name}</p>
                  <p className="text-gray-600">{cat.labelHr}</p>
                  <p className="mt-2 text-xs text-gray-600">
                    Točna lokacija je skrivena radi sigurnosti
                  </p>
                </div>
              </Popup>
            </Circle>
          );
        }

        return (
          <Marker
            key={inst.id}
            position={[inst.lat, inst.lng]}
            icon={icon}
            eventHandlers={{
              click: () => onSelect(inst.id),
            }}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-semibold">{inst.name}</p>
                <p className="text-gray-600">{cat.labelHr}</p>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
