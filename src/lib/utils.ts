import { formatDistanceToNow } from "date-fns";
import { UrgencyLevel } from "./types";

export function timeAgo(dateStr: string): string {
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
}

export function urgencyLabel(urgency: UrgencyLevel): string {
  switch (urgency) {
    case "urgent":
      return "Urgent";
    case "needed_soon":
      return "Needed soon";
    case "routine":
      return "Routine";
  }
}

export function urgencyColor(urgency: UrgencyLevel): string {
  switch (urgency) {
    case "urgent":
      return "bg-red-100 text-red-700 border-red-200";
    case "needed_soon":
      return "bg-orange-100 text-orange-700 border-orange-200";
    case "routine":
      return "bg-gray-100 text-gray-600 border-gray-200";
  }
}

export function progressPercent(pledged: number, needed: number | null): number {
  if (!needed || needed === 0) return 0;
  return Math.min(100, Math.round((pledged / needed) * 100));
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

export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
