import type { Metadata } from "next";
import MapExperience from "./map/map-experience";
import { initialMapQuery } from "./map/map-state";
import { getMapBootstrap } from "@/lib/public-map-bootstrap";
import { getLocale, getTranslator } from "@/i18n/server";
import { pageMetadata } from "@/lib/seo";

// Every viewport, filter and selection is the same page, so the front door
// canonicalises to itself rather than to its own query strings.
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  return pageMetadata({
    title: t("seo.site_title"),
    description: t("seo.site_description"),
    path: "/",
    locale,
    imageAlt: t("seo.share_image_alt"),
  });
}

export default async function Home({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
  }
  const bootstrap = await getMapBootstrap(initialMapQuery(params));
  return <MapExperience bootstrap={bootstrap} />;
}
