import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "DajSrce — Povežimo one koji daju s onima kojima treba",
  description:
    "Interaktivna karta socijalnih ustanova u Zagrebu. Pronađite gdje donirati, volontirati i pomoći.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hr">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
