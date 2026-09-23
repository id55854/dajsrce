/**
 * Stable, client-facing reasons a pledge or volunteer signup was refused.
 *
 * The transactional RPCs (`create_pledge_transaction`,
 * `volunteer_signup_transaction`) lock the row and raise these conditions, so
 * they are the source of truth for capacity; the UI only mirrors them. The
 * routes return the code next to their opaque `error`, never the raw database
 * message.
 */
export type CapacityErrorCode =
  | "already_signed_up"
  | "event_full"
  | "event_ended"
  | "need_fulfilled"
  | "exceeds_remaining";

export function capacityErrorCode(error: {
  code?: string | null;
  message?: string | null;
}): CapacityErrorCode | null {
  if (error.code === "23505") return "already_signed_up";
  if (error.code !== "23514") return null;
  const message = error.message ?? "";
  if (message.includes("event is full")) return "event_full";
  if (message.includes("event has ended")) return "event_ended";
  if (message.includes("already fulfilled")) return "need_fulfilled";
  if (message.includes("exceeds remaining")) return "exceeds_remaining";
  return null;
}
