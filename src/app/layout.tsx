import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ToastProvider } from "@/components/ui";
import { LocaleProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";

// Root metadata is the one place that cannot read the dictionary through the
// normal client/server translator, because it is evaluated before any locale
// provider exists. Keep these two entries in sync with the i18n dictionaries.
const ROOT_METADATA = {
  hr: {
    title: "DajSrce — Povežite darivatelje s onima kojima je pomoć potrebna",
    description:
      "Karta ustanova, udruga i volonterskih prilika u Hrvatskoj. Pronađite gdje donirati, volontirati i pomoći.",
  },
  en: {
    title: "DajSrce — Connecting donors with those in need",
    description:
      "A map of institutions, associations and volunteering opportunities across Croatia. Find where to donate, volunteer, and help.",
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const copy = ROOT_METADATA[locale] ?? ROOT_METADATA.hr;
  return {
    title: copy.title,
    description: copy.description,
    icons: {
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
      shortcut: [{ url: "/icon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
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

const appFont = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-ext-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-ext-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-app-sans",
  fallback: ["system-ui", "sans-serif"],
});

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
      <body className={`${appFont.variable} bg-surface text-ink`}>
        <LocaleProvider initialLocale={locale}>
          <ToastProvider>
            <div id="app-content" className="flex min-h-dvh flex-col">
              <Navbar />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
          </ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
