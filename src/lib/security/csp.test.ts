import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./csp";

describe("content security policy", () => {
  it("allows a specific script nonce and does not allow unsafe inline scripts in production", () => {
    const policy = contentSecurityPolicy({ nonce: "noncevalue", development: false });
    expect(policy).toContain("script-src 'self' 'nonce-noncevalue' 'strict-dynamic'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("keeps the dev evaluator for the bundler only", () => {
    const policy = contentSecurityPolicy({ nonce: "noncevalue", development: true });
    expect(policy).toContain("'unsafe-eval'");
  });
});
