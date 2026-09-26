import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// Next's own matcher, so the test agrees with how the source is compiled.
const { pathToRegexp } = createRequire(import.meta.url)(
  "next/dist/compiled/path-to-regexp"
) as { pathToRegexp: (source: string, keys?: unknown[], options?: object) => RegExp };

describe("next.config redirects", () => {
  it("redirects moved routes at the edge instead of from a rendered page", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({ source: "/map", destination: "/", permanent: true });
    expect(redirects).toContainEqual({ source: "/needs", destination: "/doniraj", permanent: true });
    expect(redirects).toContainEqual({
      source: "/quick-start",
      destination: "/doniraj?view=explore",
      permanent: true,
    });
    for (const [view, destination] of [["needs", "/doniraj"], ["help", "/doniraj?view=explore"]]) {
      expect(redirects).toContainEqual({
        source: "/organisations",
        has: [{ type: "query", key: "view", value: view }],
        destination,
        permanent: false,
      });
    }
  });

  it("moves exactly the production alias to dajsrce.hr, but not its API", async () => {
    const redirects = await nextConfig.redirects!();
    const alias = redirects.filter((redirect) => redirect.has?.some((condition) => condition.type === "host"));
    expect(alias).toEqual([
      {
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: "dajsrce.vercel.app" }],
        destination: "https://dajsrce.hr/:path",
        permanent: true,
      },
    ]);

    const source = pathToRegexp(alias[0].source, [], { strict: true, sensitive: false, delimiter: "/" });
    expect(source.exec("/")?.[1]).toBe("");
    expect(source.exec("/organisations/271126")?.[1]).toBe("organisations/271126");
    // A scheduler still pointed at the alias must keep reaching the route.
    expect(source.exec("/api/cron/event-reminders")).toBeNull();
  });

  it("keeps the security headers on every route", async () => {
    const [rule] = await nextConfig.headers!();
    expect(rule.source).toBe("/:path*");
    expect(rule.headers.map((header) => header.key)).toEqual(
      expect.arrayContaining(["Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options"])
    );
  });
});
