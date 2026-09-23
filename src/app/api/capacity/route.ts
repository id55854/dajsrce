import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logError } from "@/lib/observability";
import { isUuid, jsonError, rateLimit, withRequestId } from "@/lib/security/http";
import { createPublicSupabaseClient } from "@/lib/supabase/public";

/**
 * Current capacity counters for the cards on screen; polled by
 * `useLiveCapacity` in place of the Supabase Realtime channel Neon cannot
 * provide. Both tables are public, and only the counter columns are returned.
 * Clients sort the ids, so one screenful of cards is one CDN key.
 */
const COLUMNS = {
  needs: "id, quantity_needed, quantity_pledged, is_fulfilled",
  volunteer_events: "id, volunteers_needed, volunteers_signed_up",
} as const;

const MAX_IDS = 60;

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const blocked = rateLimit(req, { name: "capacity.get", limit: 120, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;

  const { searchParams } = new URL(req.url);
  const table = searchParams.get("table");
  if (table !== "needs" && table !== "volunteer_events") {
    return jsonError("table is invalid", 400, requestId);
  }
  const ids = [...new Set((searchParams.get("ids") ?? "").split(",").filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_IDS || !ids.every(isUuid)) {
    return jsonError("ids is invalid", 400, requestId);
  }

  const { data, error } = await createPublicSupabaseClient()
    .from(table)
    .select(COLUMNS[table])
    .in("id", ids);
  if (error) {
    logError("capacity_read_failed", error, { requestId, table });
    return jsonError("Capacity unavailable", 503, requestId, { "Cache-Control": "no-store" });
  }

  return NextResponse.json(
    { rows: data ?? [] },
    {
      headers: withRequestId(
        { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=30" },
        requestId
      ),
    }
  );
}
