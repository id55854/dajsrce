import type { SupabaseClient } from "@supabase/supabase-js";

const RADIUS_KM = 3;

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function notifyNearbyUsers(
  supabaseAdmin: SupabaseClient,
  institutionLat: number,
  institutionLng: number,
  title: string,
  body: string,
  link: string | null,
  excludeUserId?: string
) {
  const degBuffer = RADIUS_KM / 111;

  const { data: nearbyUsers } = await supabaseAdmin
    .from("profiles")
    .select("id, lat, lng")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .gte("lat", institutionLat - degBuffer)
    .lte("lat", institutionLat + degBuffer)
    .gte("lng", institutionLng - degBuffer)
    .lte("lng", institutionLng + degBuffer)
    .eq("role", "citizen");

  if (!nearbyUsers || nearbyUsers.length === 0) return 0;

  const notifications = nearbyUsers
    .filter((u) => {
      if (excludeUserId && u.id === excludeUserId) return false;
      return haversineKm(u.lat!, u.lng!, institutionLat, institutionLng) <= RADIUS_KM;
    })
    .map((u) => ({
      user_id: u.id,
      title,
      body,
      link,
      is_read: false,
    }));

  if (notifications.length === 0) return 0;

  const { error } = await supabaseAdmin
    .from("notifications")
    .insert(notifications);

  if (error) {
    console.error("Failed to insert notifications:", error.message);
    return 0;
  }

  return notifications.length;
}
