import type { Metadata } from "next";
import { getLocale, getTranslator } from "@/i18n/server";
import { isUuid } from "@/lib/security/http";
import { pageMetadata } from "@/lib/seo";
import { VolunteerClient } from "./volunteer-client";

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  return pageMetadata({
    title: `${t("volunteer_page.title")} | DajSrce`,
    description: t("volunteer_page.subtitle"),
    path: "/volunteer",
    locale,
    imageAlt: t("seo.share_image_alt"),
  });
}

/**
 * `?event=<id>` opens that event: it is where sign-in returns a visitor who
 * tried to join before signing in, and a link that can be shared.
 */
export default async function VolunteerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { event } = await searchParams;
  return <VolunteerClient focusEventId={isUuid(event) ? event : null} />;
}
