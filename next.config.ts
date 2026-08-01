import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://nominatim.openstreetmap.org",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  // Receipt generation resolves Noto Sans font files from this package at
  // runtime. Keeping it external prevents Webpack from parsing WOFF bytes as
  // JavaScript and ensures Next's output tracer retains the package assets.
  serverExternalPackages: [
    "@expo-google-fonts/noto-sans",
    "@fontsource/noto-sans",
    "@pdf-lib/fontkit",
  ],
  outputFileTracingIncludes: {
    "/api/companies/[id]/receipts": [
      "./node_modules/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf",
      "./node_modules/@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf",
    ],
    "/api/companies/[id]/csr-reports": [
      "./node_modules/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf",
      "./node_modules/@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf",
    ],
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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self)" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
