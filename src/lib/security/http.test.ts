import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  isBase64UrlToken,
  isUuid,
  rateLimit,
  requireSameOrigin,
  safeInternalPath,
} from "./http";

describe("HTTP security helpers", () => {
  it("allows only internal redirect paths", () => {
    expect(safeInternalPath("/dashboard?tab=needs")).toBe("/dashboard?tab=needs");
    expect(safeInternalPath("https://evil.example/dashboard")).toBe("/dashboard");
    expect(safeInternalPath("//evil.example/path")).toBe("/dashboard");
    expect(safeInternalPath("javascript:alert(1)")).toBe("/dashboard");
    expect(safeInternalPath("/\\evil")).toBe("/dashboard");
  });

  it("validates UUIDs and generated bearer token shape", () => {
    expect(isUuid("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isBase64UrlToken("abcDEF123_-".repeat(4))).toBe(true);
    expect(isBase64UrlToken("abc.def")).toBe(false);
  });

  it("rejects cross-site mutation requests", () => {
    const request = new NextRequest("http://localhost/api/needs", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(requireSameOrigin(request, "request-1234")?.status).toBe(403);
  });

  it("allows same-origin mutation requests", () => {
    const request = new NextRequest("http://localhost/api/needs", {
      method: "POST",
      headers: { origin: "http://localhost" },
    });
    expect(requireSameOrigin(request, "request-1234")).toBeNull();
  });

  it("returns 429 after a route-specific limit is exceeded", () => {
    const name = `test.${crypto.randomUUID()}`;
    const request = new NextRequest("http://localhost/api/needs", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.10" },
    });

    expect(rateLimit(request, { name, limit: 1, windowMs: 60_000 }, "request-1234")).toBeNull();
    expect(rateLimit(request, { name, limit: 1, windowMs: 60_000 }, "request-1234")?.status).toBe(429);
  });
});
