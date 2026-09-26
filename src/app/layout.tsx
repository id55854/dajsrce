import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { AccessibilityMenu } from "@/components/AccessibilityMenu";
import { Footer } from "@/components/Footer";
import { ToastProvider } from "@/components/ui";
import { LocaleProvider } from "@/i18n/client";
import { getLocale, getTranslator } from "@/i18n/server";
import { SITE_NAME, SITE_URL, openGraphLocale } from "@/lib/seo";

/**
 * Defaults every page inherits. The share image comes from
 * `opengraph-image.tsx` and the iOS home-screen icon from `apple-icon.tsx`
 * (iOS ignores an SVG touch icon). No canonical URL here: every child page
 * would inherit it and declare itself a copy of the home page.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  const title = t("seo.site_title");
  const description = t("seo.site_description");
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    applicationName: SITE_NAME,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: openGraphLocale(locale),
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
    icons: {
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
      shortcut: [{ url: "/icon.svg", type: "image/svg+xml" }],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout paint into the display cutout / home-indicator area, which
  // is what makes `env(safe-area-inset-*)` padding meaningful on iOS.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#030712" },
  ],
};

// Fontsource ships each face as two files: `latin` (a-z, digits,
// punctuation) and `latin-ext` (č, ć, đ, š, ž and the rest). The unicode-range
// that normally joins them is not emitted by next/font/local, so each file is
// its own family and the stack below lists both. Loading `latin-ext` alone
// used to draw every ordinary letter in the size-adjusted Arial fallback and
// only the diacritics in Noto Sans. `adjustFontFallback: false` keeps that
// fallback out of the stack, where it would win over the `latin-ext` family.
const appLatin = localFont({
  src: [
    { path: "../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-app-latin",
  adjustFontFallback: false,
});

const appLatinExt = localFont({
  src: [
    { path: "../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-ext-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-app-latin-ext",
  adjustFontFallback: false,
  preload: false,
});

// Small print (helper text, meta lines, counts) is set in Source Sans 3: a
// warmer, more open face at 12px than Noto Sans, with a plain zero so dates
// and counts read normally.
const smallLatin = localFont({
  src: [
    { path: "../../node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-small-latin",
  adjustFontFallback: false,
});

const smallLatinExt = localFont({
  src: [
    { path: "../../node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-ext-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-small-latin-ext",
  adjustFontFallback: false,
  preload: false,
});

const fontVariables = [appLatin, appLatinExt, smallLatin, smallLatinExt]
  .map((font) => font.variable)
  .join(" ");

// Applied before first paint so neither the theme nor the accessibility
// settings flash their default state on load. Mirrors the contracts in
// ThemeToggle ("theme") and AccessibilityMenu ("dajsrce-a11y"); the keys here
// must stay in sync with that component's CLASS_MAP.
const PRE_PAINT_SCRIPT = `(function(){
try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}
try{var a=JSON.parse(localStorage.getItem("dajsrce-a11y")||"{}"),r=document.documentElement,m={highContrast:"high-contrast",dyslexiaFont:"dyslexia-font",highlightLinks:"highlight-links",increaseSpacing:"increase-spacing",grayscale:"grayscale-mode",bigCursor:"big-cursor",stopAnimations:"stop-animations"};if(typeof a.fontSize==="number"&&a.fontSize!==100)r.style.fontSize=a.fontSize+"%";for(var k in m)if(a[k])r.classList.add(m[k])}catch(e){}
})()`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} />
      </head>
      <body className={`${fontVariables} bg-surface text-ink`}>
        <LocaleProvider initialLocale={locale}>
          <ToastProvider>
            <div id="app-content" className="flex min-h-dvh flex-col">
              <Navbar />
              <main className="flex-1">{children}</main>
              <Footer />
              <AccessibilityMenu />
            </div>
          </ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
