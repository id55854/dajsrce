import type { Feature, Polygon } from "geojson";
import type { PublicMapInstitution } from "./location-map";

// MapLibre's 512px world is one zoom level ahead of the existing 256px API.
export const toMapZoom = (zoom: number) => Math.max(5, Math.min(18, zoom - 1));
export const toPublicZoom = (zoom: number) => zoom + 1;

/** Only already-projected public coordinates enter this 2.2 km safety area. */
export function hiddenArea(institution: Pick<PublicMapInstitution, "id" | "latitude" | "longitude">, color: string, selected: boolean): Feature<Polygon> {
  const latitude = institution.latitude * Math.PI / 180;
  const longitude = institution.longitude * Math.PI / 180;
  const radius = 2200 / 6371008.8;
  const coordinates: number[][] = [];
  for (let index = 0; index <= 64; index++) {
    const bearing = index / 64 * 2 * Math.PI;
    const lat = Math.asin(Math.sin(latitude) * Math.cos(radius) + Math.cos(latitude) * Math.sin(radius) * Math.cos(bearing));
    const lng = longitude + Math.atan2(Math.sin(bearing) * Math.sin(radius) * Math.cos(latitude), Math.cos(radius) - Math.sin(latitude) * Math.sin(lat));
    coordinates.push([lng * 180 / Math.PI, lat * 180 / Math.PI]);
  }
  return { type: "Feature", properties: { id: institution.id, color, selected }, geometry: { type: "Polygon", coordinates: [coordinates] } };
}
