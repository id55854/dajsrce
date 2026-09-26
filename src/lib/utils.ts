import { formatDistanceToNow } from "date-fns";
import { enUS, hr } from "date-fns/locale";

/** "prije 2 sata" / "2 hours ago"; the locale must come from the UI, not the browser. */
export function timeAgo(dateStr: string, locale: "hr" | "en" = "hr"): string {
  return formatDistanceToNow(new Date(dateStr), {
    addSuffix: true,
    locale: locale === "en" ? enUS : hr,
  });
}

export function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/**
 * Diacritic-insensitive lowercase. Strips Croatian-specific marks so users can
 * type "kriz" / "Križ" / "KRIŽ" interchangeably.
 */
export function normalizeText(s: string): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * "Rebro 38/16, Sesvete", not "Rebro 38/16, Sesvete, Sesvete": many stored
 * addresses already end with their city, so it is appended only when the
 * address does not already name it. The city has to be a whole part of the
 * address ("…, Sesvete" or "…, 10360 Sesvete"), so a street named after its
 * city ("Splitska 5" in Split) still gets it. A missing address yields the
 * city alone rather than ", Zagreb".
 */
export function addressWithCity(
  address: string | null | undefined,
  city: string | null | undefined
): string {
  const street = address?.trim() ?? "";
  const place = city?.trim() ?? "";
  if (!street) return place;
  if (!place) return street;
  const target = normalizeText(place);
  const named = street
    .split(",")
    .map((part) => normalizeText(part.trim()))
    .some((part) => part === target || part.endsWith(` ${target}`));
  return named ? street : `${street}, ${place}`;
}
