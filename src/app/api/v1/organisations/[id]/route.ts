import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { AssociationRegistryEntry } from "@/lib/association-registry";
import { createPublicSupabaseClient } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, s-maxage=600, stale-while-revalidate=86400";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = randomUUID();
  const { id } = await context.params;
  if (!/^\d{1,20}$/.test(id)) {
    return NextResponse.json(
      { error: "Invalid registry identifier" },
      { status: 400, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
    );
  }

  try {
    const supabase = createPublicSupabaseClient();
    const { data, error } = await supabase.rpc("get_association_registry_entry_v1", {
      p_udr_id: id,
    });
    if (error) throw new Error(`Directory detail failed (${error.code ?? "database"})`);
    if (!data) {
      return NextResponse.json(
        { error: "Organisation not found" },
        { status: 404, headers: { "Cache-Control": "public, s-maxage=60", "X-Request-Id": requestId } }
      );
    }

    const body = JSON.stringify({ version: 1, organisation: data as AssociationRegistryEntry });
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
      status: 200,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    console.error("association_directory_detail_failed", {
      requestId,
      id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "The official organisation record is temporarily unavailable", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
    );
  }
}
