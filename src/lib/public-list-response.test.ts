import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { publicListResponse } from "./public-list-response";

describe("public list timing", () => {
  it("reports origin timings without changing the payload or cache identity", async () => {
    const req = new NextRequest("https://example.test/api/needs");
    const first = publicListResponse(req, { needs: [] }, "request-1", { queryMs: 12.34, totalMs: 20.12 });
    const second = publicListResponse(req, { needs: [] }, "request-2", { queryMs: 99, totalMs: 100 });
    expect(first.headers.get("server-timing")).toBe("supabase;dur=12.3, handler;dur=20.1");
    expect(first.headers.get("etag")).toBe(second.headers.get("etag"));
    expect(await first.json()).toEqual({ needs: [], request_id: "request-1" });
  });

  it("preserves conditional responses and shared caching", () => {
    const req = new NextRequest("https://example.test/api/needs");
    const first = publicListResponse(req, { needs: [] }, "request-1");
    const conditional = new NextRequest(req.url, { headers: { "if-none-match": first.headers.get("etag")! } });
    const response = publicListResponse(conditional, { needs: [] }, "request-2", { queryMs: 1, totalMs: 2 });
    expect(response.status).toBe(304);
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    expect(response.headers.get("server-timing")).toBeTruthy();
  });
});
