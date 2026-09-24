import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimitDurable } from "./rate-limit-durable";

describe("shared rate limit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stops before the shared store once the local bucket is already full", async () => {
    const consume = vi.fn(async () => "allowed" as const);
    const name = `test.durable.${crypto.randomUUID()}`;
    const request = new NextRequest("http://localhost/api/auth/password-recovery", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.50" },
    });

    expect(
      await rateLimitDurable(request, { name, limit: 1, windowMs: 60_000 }, "request-1234", consume)
    ).toBeNull();
    const blocked = await rateLimitDurable(
      request,
      { name, limit: 1, windowMs: 60_000 },
      "request-1234",
      consume
    );
    expect(blocked?.status).toBe(429);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it("honours a shared denial even when this instance still has room", async () => {
    const consume = vi.fn(async () => "limited" as const);
    const request = new NextRequest("http://localhost/api/auth/password-recovery", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.51" },
    });
    const response = await rateLimitDurable(
      request,
      { name: `test.shared.${crypto.randomUUID()}`, limit: 5, windowMs: 60_000 },
      "request-1234",
      consume
    );
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
  });

  it("fails closed in production when the shared store errors", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest("http://localhost/api/auth/password-recovery", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.52" },
    });
    const response = await rateLimitDurable(
      request,
      { name: `test.down.${crypto.randomUUID()}`, limit: 5, windowMs: 60_000 },
      "request-1234",
      async () => {
        throw new Error("database unavailable");
      }
    );
    expect(response?.status).toBe(503);
  });
});
