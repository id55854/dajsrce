import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getDictionary, resolveKey } from "@/i18n/dictionaries";
import { BRAND_COLORS, BRAND_HEART_PATH } from "@/lib/brand";

/**
 * The link preview for every page (WhatsApp, Viber, Facebook, LinkedIn,
 * Slack, X). Croatian, because that is who the links are sent to; a page's
 * own title and description still travel beside it as text.
 *
 * Nothing is fetched while rendering. Satori would otherwise pull glyphs it
 * lacks (č, ć, đ, š, ž are outside basic Latin) from Google Fonts and an emoji
 * heart from a CDN, so the fonts are the self-hosted Noto Sans files the site
 * already ships (WOFF, which Satori reads; it cannot read WOFF2) and the
 * heart is the logo's own SVG path.
 *
 * The Latin-Ext subset is registered as its own family, second in the stack.
 * Satori resolves one font per family name, so under a shared name it would
 * never consult the second file and would fetch the diacritics instead.
 */
const copy = getDictionary("hr");

export const alt = resolveKey(copy, "seo.share_image_alt");
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Literal paths so the output tracer keeps the files if this ever renders at
// request time rather than at build.
function loadFonts() {
  const root = process.cwd();
  return Promise.all([
    readFile(join(root, "node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff")),
    readFile(join(root, "node_modules/@fontsource/noto-sans/files/noto-sans-latin-ext-700-normal.woff")),
    readFile(join(root, "node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff")),
    readFile(join(root, "node_modules/@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff")),
  ]);
}

export default async function OpenGraphImage() {
  const [bold, boldExt, regular, regularExt] = await loadFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          backgroundImage: `linear-gradient(135deg, ${BRAND_COLORS.surface} 0%, ${BRAND_COLORS.surfaceTint} 100%)`,
          color: BRAND_COLORS.ink,
          fontFamily: '"Noto Sans", "Noto Sans Latin Ext"',
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 104,
              height: 104,
              borderRadius: 9999,
              backgroundColor: BRAND_COLORS.brandSoft,
            }}
          >
            <svg width="64" height="64" viewBox="0 0 24 24">
              <path d={BRAND_HEART_PATH} fill={BRAND_COLORS.brand} />
            </svg>
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: BRAND_COLORS.brand,
            }}
          >
            DajSrce
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1000 }}>
          <div style={{ fontSize: 62, fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.02em" }}>
            {resolveKey(copy, "seo.share_image_headline")}
          </div>
          <div style={{ fontSize: 32, lineHeight: 1.35, color: BRAND_COLORS.inkSecondary }}>
            {resolveKey(copy, "seo.share_image_subline")}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 30,
            fontWeight: 700,
            color: BRAND_COLORS.inkSecondary,
          }}
        >
          <div>dajsrce.hr</div>
          <div
            style={{
              display: "flex",
              width: 220,
              height: 12,
              borderRadius: 9999,
              backgroundColor: BRAND_COLORS.brand,
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Noto Sans", data: bold, weight: 700, style: "normal" },
        { name: "Noto Sans", data: regular, weight: 400, style: "normal" },
        { name: "Noto Sans Latin Ext", data: boldExt, weight: 700, style: "normal" },
        { name: "Noto Sans Latin Ext", data: regularExt, weight: 400, style: "normal" },
      ],
    }
  );
}
