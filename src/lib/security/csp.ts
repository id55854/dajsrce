type ContentSecurityPolicyOptions = {
  nonce: string;
  development: boolean;
  /** Extra connect origins, such as the Neon Data API. Empty values are dropped. */
  connectOrigins?: string[];
};

/**
 * One policy for every HTML response. A nonce plus `strict-dynamic` replaces
 * `'unsafe-inline'` on scripts: browsers that understand a nonce ignore
 * `'unsafe-inline'`, so leaving it in the policy would not actually allow a
 * new inline script, and omitting it keeps the intent obvious.
 *
 * Styles stay `'unsafe-inline'` because the design system emits utility CSS
 * at runtime. That does not widen script execution.
 */
export function contentSecurityPolicy({
  nonce,
  development,
  connectOrigins = [],
}: ContentSecurityPolicyOptions): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    development ? "'unsafe-eval'" : null,
  ].filter((part): part is string => Boolean(part));
  const connectSrc = [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    ...connectOrigins.filter((origin) => origin.length > 0),
    "https://nominatim.openstreetmap.org",
    "https://vitals.vercel-insights.com",
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://*.supabase.co https://basemaps.cartocdn.com https://tile.openstreetmap.org",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
