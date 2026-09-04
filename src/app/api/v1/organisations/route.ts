import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ASSOCIATION_DIRECTORY_API_VERSION,
  AssociationDirectoryQueryError,
  associationDirectoryRpcArgs,
  parseAssociationDirectoryQuery,
  type AssociationDirectoryItem,
  type AssociationDirectoryResponse,
} from "@/lib/association-registry";
import { logError } from "@/lib/observability";
import { createPublicSupabaseClient } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

const PUBLIC_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

type SearchRpcResponse = {
  version?: number;
  items?: AssociationDirectoryItem[];
  meta?: { total?: number; page?: number; page_size?: number; page_count?: number };
};

type FacetsRpcResponse = AssociationDirectoryResponse["facets"];

function cachedJson(req: NextRequest, body: AssociationDirectoryResponse, requestId: string) {
  const serialized = JSON.stringify(body);
  const etag = `"${createHash("sha256").update(serialized).digest("base64url")}"`;
  const headers = {
    "Cache-Control": PUBLIC_CACHE_CONTROL,
    ETag: etag,
    Vary: "Accept-Encoding",
    "X-Request-Id": requestId,
  };
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(serialized, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  let query;
  try {
    query = parseAssociationDirectoryQuery(req.nextUrl.searchParams);
  } catch (error) {
    if (error instanceof AssociationDirectoryQueryError) {
      return NextResponse.json(
        { error: "Invalid organisation directory query", issues: error.issues },
        { status: 400, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
      );
    }
    throw error;
  }

  try {
    const supabase = createPublicSupabaseClient();
    const [searchResult, facetsResult] = await Promise.all([
      supabase.rpc("search_association_registry_v1", associationDirectoryRpcArgs(query)),
      supabase.rpc("association_registry_facets_v1"),
    ]);
    if (searchResult.error) {
      throw new Error(`Directory search failed (${searchResult.error.code ?? "database"})`);
    }
    if (facetsResult.error) {
      throw new Error(`Directory facets failed (${facetsResult.error.code ?? "database"})`);
    }

    const search = (searchResult.data ?? {}) as SearchRpcResponse;
    const facets = (facetsResult.data ?? {}) as FacetsRpcResponse;
    const response: AssociationDirectoryResponse = {
      version: ASSOCIATION_DIRECTORY_API_VERSION,
      items: Array.isArray(search.items) ? search.items : [],
      meta: {
        total: Number(search.meta?.total ?? 0),
        page: Number(search.meta?.page ?? query.page),
        pageSize: Number(search.meta?.page_size ?? query.pageSize),
        pageCount: Number(search.meta?.page_count ?? 0),
      },
      facets: {
        total: Number(facets.total ?? 0),
        statuses: Array.isArray(facets.statuses) ? facets.statuses : [],
        counties: Array.isArray(facets.counties) ? facets.counties : [],
        forms: Array.isArray(facets.forms) ? facets.forms : [],
        snapshot: facets.snapshot ?? null,
      },
    };
    return cachedJson(req, response, requestId);
  } catch (error) {
    logError("association_directory_query_failed", error, { request_id: requestId });
    return NextResponse.json(
      { error: "The official organisation directory is temporarily unavailable", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } }
    );
  }
}
