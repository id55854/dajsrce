import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ASSOCIATION_DIRECTORY_API_VERSION,
  AssociationDirectoryQueryError,
  engagedDirectoryRpcArgs,
  parseEngagedDirectoryQuery,
  type EngagedAssociationItem,
  type EngagedDirectoryResponse,
} from "@/lib/association-registry";
import { createPublicSupabaseClient } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

// Shorter than the register's own cache: this listing moves whenever an
// organisation publishes or fulfils a need, not once per snapshot.
const PUBLIC_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=600";

type EngagedRpcResponse = {
  items?: EngagedAssociationItem[];
  meta?: { total?: number; page?: number; page_size?: number; page_count?: number };
};

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  let query;
  try {
    query = parseEngagedDirectoryQuery(req.nextUrl.searchParams);
  } catch (error) {
    if (error instanceof AssociationDirectoryQueryError) {
      return NextResponse.json(
        { error: "Invalid organisation query", issues: error.issues },
        { status: 400, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
      );
    }
    throw error;
  }

  try {
    const supabase = createPublicSupabaseClient();
    const { data, error } = await supabase.rpc(
      "engaged_association_directory_v1",
      engagedDirectoryRpcArgs(query)
    );
    if (error) {
      throw new Error(`Engaged directory query failed (${error.code ?? "database"})`);
    }

    const result = (data ?? {}) as EngagedRpcResponse;
    const response: EngagedDirectoryResponse = {
      version: ASSOCIATION_DIRECTORY_API_VERSION,
      items: Array.isArray(result.items) ? result.items : [],
      meta: {
        total: Number(result.meta?.total ?? 0),
        page: Number(result.meta?.page ?? query.page),
        pageSize: Number(result.meta?.page_size ?? query.pageSize),
        pageCount: Number(result.meta?.page_count ?? 0),
      },
    };

    const body = JSON.stringify(response);
    const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
    const headers = {
      "Cache-Control": PUBLIC_CACHE_CONTROL,
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
    console.error("engaged_directory_query_failed", {
      requestId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "The organisation list is temporarily unavailable", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
    );
  }
}
