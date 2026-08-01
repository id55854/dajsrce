import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { AccessibilityMenu } from "@/components/AccessibilityMenu";
import { LocaleProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";

export const metadata: Metadata = {
  title: "DajSrce — Connecting donors with those in need",
  description:
    "Interactive map of social institutions in Zagreb. Find where to donate, volunteer, and help.",
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

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${appFont.variable} bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100`}>
        <LocaleProvider initialLocale={locale}>
          <div id="app-content" className="min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
          <AccessibilityMenu />
        </LocaleProvider>
      </body>
    </html>
  );
}
