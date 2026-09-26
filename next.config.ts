import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";

// Signed-in pages query the Neon Data API from the browser (see
// src/lib/supabase/client.ts); Supabase remains for Auth only.
function dataApiOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_DATA_API_URL ?? "").origin;
  } catch {
    return "";
  }
}

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://*.supabase.co https://basemaps.cartocdn.com https://tile.openstreetmap.org",
  `connect-src 'self' https://*.supabase.co ${dataApiOrigin()} https://nominatim.openstreetmap.org`.replace(/  +/g, " "),
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Builds must not overwrite the files used by a running local dev server.
  distDir: isDevelopment ? ".next-dev" : ".next",
  compress: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  // The site's local Noto Sans build resolves its font files from this
  // package at runtime. Keeping it external prevents Webpack from parsing
  // WOFF bytes as JavaScript and ensures Next's output tracer retains the
  // package assets.
  serverExternalPackages: ["@fontsource/noto-sans"],
  // Moved routes redirect here, before any rendering. As `redirect()` calls in
  // a page they ran after a loading boundary had already streamed a 200, so
  // crawlers saw "200 plus meta refresh" instead of a 308. The request's query
  // string is carried over, so old shared map views still land where they
  // pointed (`/map?@=45.81,15.97,13` becomes `/?@=45.81,15.97,13`).
  async redirects() {
    return [
      // The production alias served a complete duplicate of the site. Exactly
      // this host: preview deployments keep their own URLs. API routes are
      // left alone, because a scheduler still pointed at the alias would get
      // a 308 it does not follow (curl without -L exits 0) and silently stop
      // running.
      {
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: "dajsrce.vercel.app" }],
        destination: "https://dajsrce.hr/:path",
        permanent: true,
      },
      { source: "/map", destination: "/", permanent: true },
      { source: "/needs", destination: "/doniraj", permanent: true },
      { source: "/quick-start", destination: "/doniraj?view=explore", permanent: true },
      // The register's old sub-views. Anything else under `?view=` is still
      // canonicalised away by the page itself.
      {
        source: "/organisations",
        has: [{ type: "query", key: "view", value: "needs" }],
        destination: "/doniraj",
        permanent: false,
      },
      {
        source: "/organisations",
        has: [{ type: "query", key: "view", value: "help" }],
        destination: "/doniraj?view=explore",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
