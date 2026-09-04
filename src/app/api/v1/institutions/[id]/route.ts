import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  trustStatus,
  type PublicInstitutionDetail,
} from "@/lib/location-map";
import { logError } from "@/lib/observability";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import type { DonationType, InstitutionCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

type DetailRow = {
  id: string;
  name: string;
  category: InstitutionCategory;
  description: string;
  address: string | null;
  city: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  email: string | null;
  website: string | null;
  working_hours: string | null;
  drop_off_hours: string | null;
  accepts_donations: DonationType[] | null;
  capacity: string | null;
  served_population: string | null;
  photo_url: string | null;
  is_verified: boolean | null;
  is_location_hidden: boolean | null;
  approximate_area: string | null;
  nearest_zet_stop: string | null;
  zet_lines: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
};

type FallbackDetailRow = Omit<DetailRow, "latitude" | "longitude" | "address"> & {
  public_lat: number;
  public_lng: number;
};

function mapDetail(row: DetailRow): PublicInstitutionDetail {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    address: row.is_location_hidden ? null : row.address,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    phone: row.phone,
    email: row.email,
    website: row.website,
    workingHours: row.working_hours,
    dropOffHours: row.drop_off_hours,
    acceptsDonations: row.accepts_donations ?? [],
    capacity: row.capacity,
    servedPopulation: row.served_population,
    photoUrl: row.photo_url,
    isVerified: Boolean(row.is_verified),
    isLocationHidden: Boolean(row.is_location_hidden),
    approximateArea: row.approximate_area,
    nearestZetStop: row.nearest_zet_stop,
    zetLines: row.zet_lines,
    trustStatus: trustStatus(Boolean(row.is_verified), row.source),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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
    const row = ((data ?? []) as DetailRow[])[0];
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
