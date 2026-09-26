/**
 * Brand primitives for the generated images (`opengraph-image.tsx`,
 * `apple-icon.tsx`). Those are rendered by Satori, which cannot read CSS
 * custom properties, so the values are literal here; keep them in step with
 * `--brand` in globals.css and with `src/app/icon.svg`.
 */

/** The heart from `src/app/icon.svg`, on a 24x24 view box. */
export const BRAND_HEART_PATH =
  "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";

export const BRAND_COLORS = {
  brand: "#dc2626",
  brandSoft: "#fee2e2",
  surface: "#ffffff",
  surfaceTint: "#fef2f2",
  ink: "#111827",
  inkSecondary: "#4b5563",
} as const;
