import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  toPublicInstitutionDetail,
  type PublicInstitutionDetail,
  type PublicInstitutionDetailRpcRow,
} from "@/lib/location-map";
import { logError } from "@/lib/observability";
import { rateLimit } from "@/lib/security/http";
import { createPublicSupabaseClient } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

type FallbackDetailRow = Omit<PublicInstitutionDetailRpcRow, "latitude" | "longitude" | "address"> & {
  public_lat: number;
  public_lng: number;
};

// The shared mapper, not a local copy: it is where hidden and protected
// locations are projected, and a second copy is how one of them drifts.
const mapDetail = toPublicInstitutionDetail;

function missingRpc(error: { code?: string; message?: string }) {
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /public_institution_detail_v1|could not find the function/i.test(error.message ?? "")
  );
}

async function loadDetail(id: string): Promise<PublicInstitutionDetail | null> {
  const supabase = createPublicSupabaseClient();
  const { data, error } = await supabase.rpc("public_institution_detail_v1", {
    p_id: id,
  });

  if (!error) {
    const row = ((data ?? []) as PublicInstitutionDetailRpcRow[])[0];
    return row ? mapDetail(row) : null;
  }
  if (!missingRpc(error)) throw new Error(`Institution detail query failed (${error.code})`);

  // Deployment bridge only: the selected row is projected before it leaves
  // this server. Once the migration is present, the RPC is always preferred.
  const fallback = await supabase
    .from("institutions")
    .select(
      "id,name,category,description,city,public_lat,public_lng,phone,email,website,working_hours,drop_off_hours,accepts_donations,capacity,served_population,photo_url,is_verified,is_location_hidden,approximate_area,nearest_zet_stop,zet_lines,source,created_at,updated_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (fallback.error) throw new Error(`Institution detail fallback failed (${fallback.error.code})`);
  if (!fallback.data) return null;

  const row = fallback.data as FallbackDetailRow;
  return mapDetail({
    ...row,
    address: null,
    latitude: row.public_lat,
    longitude: row.public_lng,
  });
}

function cachedJson(req: NextRequest, value: unknown, requestId: string) {
  const body = JSON.stringify(value);
  const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
  const headers = {
    "Cache-Control": CACHE_CONTROL,
    ETag: etag,
    Vary: "Accept-Encoding",
    "X-Request-Id": requestId,
  };
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(body, {
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = randomUUID();
  const blocked = rateLimit(req, { name: "public.institution.detail", limit: 120, windowMs: 60_000 }, requestId);
  if (blocked) return blocked;
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { error: "Invalid institution id" },
      { status: 400, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
    );
  }

  try {
    const institution = await loadDetail(id);
    if (!institution) {
      return NextResponse.json(
        { error: "Institution not found" },
        { status: 404, headers: { "Cache-Control": "public, s-maxage=60", "X-Request-Id": requestId } }
      );
    }
    return cachedJson(req, { institution }, requestId);
  } catch (error) {
    logError("public_institution_detail_failed", error, {
      request_id: requestId,
      institutionId: id,
    });
    return NextResponse.json(
      { error: "Institution details are temporarily unavailable", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
    );
  }
}
