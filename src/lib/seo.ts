import type { Metadata } from "next";
import type { Locale } from "@/lib/types";

/**
 * The one public origin. `metadataBase`, canonical URLs, the sitemap and
 * robots.txt all resolve against it, so a preview deployment or the
 * `*.vercel.app` alias never presents itself as the canonical site.
 */
export const SITE_URL = "https://dajsrce.hr";
export const SITE_NAME = "DajSrce";

/**
 * The generated share image (`src/app/opengraph-image.tsx`). Next attaches it
 * to every page automatically, but a page that sets its own `openGraph`
 * replaces the inherited one wholesale, image included, so `pageMetadata`
 * names it again.
 */
const SHARE_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  type: "image/png",
} as const;

export function openGraphLocale(locale: Locale): string {
  return locale === "en" ? "en_US" : "hr_HR";
}

/**
 * Title, description, canonical URL and the matching Open Graph and Twitter
 * card for one public page. `title` is the full document title; callers keep
 * the existing "Page | DajSrce" convention, because the root layout sets no
 * title template.
 */
export function pageMetadata({
  title,
  description,
  path,
  locale,
  imageAlt,
}: {
  title: string;
  description: string;
  /** Site-relative canonical path, e.g. `/doniraj`. */
  path: string;
  locale: Locale;
  imageAlt: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: openGraphLocale(locale),
      url: path,
      title,
      description,
      images: [{ ...SHARE_IMAGE, alt: imageAlt }],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** Trims free text to a meta description without cutting a word in half. */
export function metaDescription(text: string | null | undefined, max = 160): string | null {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}
