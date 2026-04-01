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
import { CATEGORY_CONFIG, ZAGREB_CENTER, DEFAULT_ZOOM } from "@/lib/constants";

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

function buildIcons(dark: boolean) {
  const icons = {} as Record<InstitutionCategory, L.DivIcon>;
  for (const key of Object.keys(CATEGORY_CONFIG) as InstitutionCategory[]) {
    icons[key] = createCategoryIcon(CATEGORY_CONFIG[key].color, 32, dark);
  }
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

export type MapProps = {
  institutions: Institution[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filters: MapFilters;
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
}: MapProps) {
  const dark = useDarkMode();
  const icons = useMemo(() => buildIcons(dark), [dark]);

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
      {visible.map((inst) => {
        const cat = CATEGORY_CONFIG[inst.category];
        const icon = icons[inst.category];

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
