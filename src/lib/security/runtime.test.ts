import { describe, expect, it } from "vitest";
import {
  bearerMatchesSecret,
  getCronSecret,
  hashBearerToken,
} from "./runtime";

describe("security runtime guards", () => {
  it("fails closed for a missing or weak cron secret", () => {
    expect(getCronSecret({})).toBeNull();
    expect(getCronSecret({ CRON_SECRET: "short" })).toBeNull();
  });

  it("compares only a correctly formed bearer credential", () => {
    const secret = "a-cryptographically-random-cron-secret";
    expect(bearerMatchesSecret(`Bearer ${secret}`, secret)).toBe(true);
    expect(bearerMatchesSecret("Bearer wrong", secret)).toBe(false);
    expect(bearerMatchesSecret(null, secret)).toBe(false);
  });

  it("creates stable SHA-256 token digests without preserving the bearer", () => {
    const bearer = "0123456789abcdef".repeat(4);
    const digest = hashBearerToken(bearer);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe(hashBearerToken(bearer));
    expect(digest).not.toContain(bearer);
  });
});
