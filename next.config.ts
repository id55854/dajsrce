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
