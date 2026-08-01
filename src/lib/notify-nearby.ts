import type { SupabaseClient } from "@supabase/supabase-js";

const RADIUS_KM = 3;
const INSERT_BATCH_SIZE = 500;

export type NearbyNotificationJob = {
  id: string;
  origin_lat: number;
  origin_lng: number;
  radius_km: number;
  title: string;
  body: string;
  link: string | null;
  exclude_user_id: string | null;
  attempt_count: number;
};

function assertCoordinates(latitude: number, longitude: number): void {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("Invalid notification origin coordinates");
  }
}

/**
 * Enqueue nearby delivery and return immediately. The idempotency key should
 * name the originating domain record, for example `need:<uuid>`.
 */
export async function notifyNearbyUsers(
  supabaseAdmin: SupabaseClient,
  institutionLat: number,
  institutionLng: number,
  title: string,
  body: string,
  link: string | null,
  excludeUserId: string | undefined,
  idempotencyKey: string
): Promise<string> {
  assertCoordinates(institutionLat, institutionLng);
  const { data, error } = await supabaseAdmin.rpc("enqueue_nearby_notification", {
    p_idempotency_key: idempotencyKey,
    p_lat: institutionLat,
    p_lng: institutionLng,
    p_title: title.slice(0, 200),
    p_body: body.slice(0, 2000),
    p_link: link,
    p_exclude_user_id: excludeUserId ?? null,
    p_radius_km: RADIUS_KM,
  });
  if (error || typeof data !== "string") {
    throw new Error(`Notification enqueue failed: ${error?.message ?? "invalid job id"}`);
  }
  return data;
}

/** Deliver one claimed job. Per-user uniqueness makes retries idempotent. */
export async function deliverNearbyNotificationJob(
  supabaseAdmin: SupabaseClient,
  job: NearbyNotificationJob
): Promise<number> {
  assertCoordinates(job.origin_lat, job.origin_lng);
  const { data, error: lookupError } = await supabaseAdmin.rpc(
    "nearby_notification_profile_ids_json",
    {
      p_lat: job.origin_lat,
      p_lng: job.origin_lng,
      p_radius_km: job.radius_km,
      p_exclude_user_id: job.exclude_user_id,
    }
  );
  if (lookupError) throw new Error(`Nearby recipient lookup failed: ${lookupError.message}`);

  const profileIds = (Array.isArray(data) ? data : []).filter(
    (value): value is string => typeof value === "string"
  );
  for (let offset = 0; offset < profileIds.length; offset += INSERT_BATCH_SIZE) {
    const notifications = profileIds.slice(offset, offset + INSERT_BATCH_SIZE).map((userId) => ({
      user_id: userId,
      title: job.title,
      body: job.body,
      link: job.link,
      is_read: false,
      delivery_job_id: job.id,
    }));
    const { error } = await supabaseAdmin.from("notifications").upsert(notifications, {
      onConflict: "delivery_job_id,user_id",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(`Notification delivery failed: ${error.message}`);
  }
  return profileIds.length;
}
