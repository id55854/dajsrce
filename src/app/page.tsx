import type { Metadata } from "next";
import { Suspense } from "react";
import MapExperience, { MapPageLoading } from "./map/map-experience";
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

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The skeleton is this page's own boundary rather than a root `loading.tsx`.
 * A root boundary wrapped every route, so the 200 status was already sent by
 * the time a page called `notFound()` or `redirect()`: unknown institutions
 * and register records were soft 404s, and redirects were meta refreshes.
 */
export default function Home({ searchParams }: HomeProps) {
  return (
    <Suspense fallback={<MapPageLoading />}>
      <HomeMap searchParams={searchParams} />
    </Suspense>
  );
}

async function HomeMap({ searchParams }: HomeProps) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
  }
  const bootstrap = await getMapBootstrap(initialMapQuery(params));
  return <MapExperience bootstrap={bootstrap} />;
}
