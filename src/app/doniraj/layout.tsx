import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getLocale, getTranslator } from "@/i18n/server";
import { pageMetadata } from "@/lib/seo";

// The page is a client component and cannot export metadata, so its title,
// description and canonical URL live on the segment layout instead.
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  return pageMetadata({
    title: `${t("donate_page.title")} | DajSrce`,
    description: t("donate_page.subtitle_needs"),
    path: "/doniraj",
    locale,
    imageAlt: t("seo.share_image_alt"),
  });
}

export default function DonateLayout({ children }: { children: ReactNode }) {
  return children;
}
