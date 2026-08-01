"use client";

import "leaflet/dist/leaflet.css";

import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import type {
  MapBounds,
  PublicMapCluster,
  PublicMapFeature,
  PublicMapInstitution,
} from "@/lib/location-map";
import type { DonationType, InstitutionCategory } from "@/lib/types";
import {
  CATEGORY_CONFIG,
  FALLBACK_CATEGORY_CONFIG,
  getCategoryConfig,
} from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";

const LIGHT_TILES = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const DARK_TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

export interface MapFilters {
  categories: InstitutionCategory[];
  donationType: DonationType | null;
  onlyZagreb: boolean;
  onlyUrgent: boolean;
}

export type MapViewport = {
  bbox: MapBounds;
  zoom: number;
};

export function createCategoryIcon(
  color: string,
  size: number = 32,
  dark = false
): L.DivIcon {
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

function createClusterIcon(count: number, urgent: boolean, dark: boolean): L.DivIcon {
  const size = count >= 100 ? 48 : count >= 10 ? 42 : 36;
  const background = urgent ? "#dc2626" : "#1d4ed8";
  const border = dark ? "#111827" : "#ffffff";
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:9999px;
      display:flex;align-items:center;justify-content:center;
      background:${background};color:white;border:3px solid ${border};
      font:700 12px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)
    ">${Math.max(1, Math.trunc(count))}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
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
  icons.__fallback__ = createCategoryIcon(FALLBACK_CATEGORY_CONFIG.color, 32, dark);
  return icons;
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

function MapFlyToSelection({
  selectedId,
  institutions,
}: {
  selectedId: string | null;
  institutions: PublicMapInstitution[];
}) {
  const map = useMap();

  useEffect(() => {
    if (!selectedId) return;
    const institution = institutions.find((item) => item.id === selectedId);
    if (!institution) return;
    map.flyTo([institution.latitude, institution.longitude], Math.max(map.getZoom(), 14), {
      duration: 0.65,
    });
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
  }, [userPosition, flyTrigger, map]);

  return null;
}

function ClusterMarker({ cluster, dark }: { cluster: PublicMapCluster; dark: boolean }) {
  const t = useT();
  const map = useMap();
  const icon = useMemo(
    () => createClusterIcon(cluster.count, cluster.hasUrgentNeed, dark),
    [cluster.count, cluster.hasUrgentNeed, dark]
  );

  function zoomIntoCluster() {
    const [minLng, minLat, maxLng, maxLat] = cluster.bounds;
    if (minLng === maxLng && minLat === maxLat) {
      map.setView(
        [cluster.latitude, cluster.longitude],
        Math.min(map.getZoom() + 2, 19)
      );
      return;
    }
    map.fitBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { maxZoom: Math.min(map.getZoom() + 3, 14), padding: [24, 24] }
    );
  }

  return (
    <Marker
      position={[cluster.latitude, cluster.longitude]}
      icon={icon}
      title={t("map_ui.cluster_title", { count: cluster.count })}
      alt={t("map_ui.cluster_alt", { count: cluster.count })}
      eventHandlers={{ click: zoomIntoCluster }}
    />
  );
}

function InstitutionLayer({
  institution,
  icon,
  onSelect,
}: {
  institution: PublicMapInstitution;
  icon: L.DivIcon;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const category = getCategoryConfig(institution.category);
  const position: [number, number] = [institution.latitude, institution.longitude];

  if (institution.isLocationHidden) {
    return (
      <Circle
        center={position}
        radius={2200}
        pathOptions={{
          color: category.color,
          fillColor: category.color,
          fillOpacity: 0.18,
          weight: 2,
        }}
        eventHandlers={{ click: () => onSelect(institution.id) }}
      >
        <Popup>
          <div className="text-sm">
            <p className="font-semibold">{institution.name}</p>
            <p className="text-gray-600">{locale === "hr" ? category.labelHr : category.label}</p>
            <p className="mt-2 text-xs text-gray-600">
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
      title={institution.name}
      alt={`${institution.name}, ${locale === "hr" ? category.labelHr : category.label}`}
      eventHandlers={{ click: () => onSelect(institution.id) }}
    >
      <Popup>
        <div className="text-sm">
          <p className="font-semibold">{institution.name}</p>
          <p className="text-gray-600">{locale === "hr" ? category.labelHr : category.label}</p>
        </div>
      </Popup>
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
  features,
  selectedId,
  onSelect,
  onViewportChange,
  initialCenter,
  initialZoom,
  userPosition = null,
  flyToUserTrigger = 0,
}: MapProps) {
  const t = useT();
  const dark = useDarkMode();
  const icons = useMemo(() => buildIcons(dark), [dark]);
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
      aria-label={t("map_ui.map_aria")}
    >
      <TileLayer
        key={dark ? "dark" : "light"}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url={dark ? DARK_TILES : LIGHT_TILES}
        subdomains="abcd"
      />
      <MapViewportObserver onChange={onViewportChange} />
      <MapFlyToSelection selectedId={selectedId} institutions={institutions} />
      <MapFlyToUser userPosition={userPosition} flyTrigger={flyToUserTrigger} />
      {userPosition ? (
        <Marker
          position={[userPosition.lat, userPosition.lng]}
          icon={userIcon}
          title={t("map_ui.your_location")}
          alt={t("map_ui.your_location")}
        >
          <Popup>
            <div className="text-sm font-semibold">{t("map_ui.your_location")}</div>
          </Popup>
        </Marker>
      ) : null}
      {features.map((feature) => {
        if (feature.kind === "cluster") {
          return <ClusterMarker key={feature.id} cluster={feature} dark={dark} />;
        }
        return (
          <InstitutionLayer
            key={feature.id}
            institution={feature}
            icon={icons[feature.category] ?? icons.__fallback__}
            onSelect={onSelect}
          />
        );
      })}
    </MapContainer>
  );
}
