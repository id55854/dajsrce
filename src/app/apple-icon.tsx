import { ImageResponse } from "next/og";
import { BRAND_COLORS, BRAND_HEART_PATH } from "@/lib/brand";

/**
 * The iOS home-screen icon. iOS ignores an SVG `apple-touch-icon`, which is
 * all the site used to declare, so it drew a screenshot instead. Full-bleed
 * and opaque, because iOS rounds the corners itself and fills transparency
 * with black.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: BRAND_COLORS.brand,
        }}
      >
        <svg width="112" height="112" viewBox="0 0 24 24">
          <path d={BRAND_HEART_PATH} fill={BRAND_COLORS.surface} />
        </svg>
      </div>
    ),
    { ...size }
  );
}
