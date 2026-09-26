import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageHeader, PageShell } from "@/components/ui";
import { getLocale, getTranslator } from "@/i18n/server";
import { pageMetadata } from "@/lib/seo";
import { DirectoryLoading, DirectoryView } from "./directory-view";

// Filters and pages are views of one listing, so they all canonicalise here.
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  return pageMetadata({
    title: `${t("organisations.title")} | DajSrce`,
    description: t("organisations.subtitle"),
    path: "/organisations",
    locale,
    imageAlt: t("seo.share_image_alt"),
  });
}

/**
 * The official register, and nothing else.
 *
 * This page briefly carried four sub-views; the register, open needs, a "find
 * help" wizard and a list of onboarded organisations. Only the register is
 * actually about the register: needs and the wizard are ways of giving and now
 * live under `/doniraj`, and the onboarded list became a filter on the register
 * itself rather than a separate tab.
 *
 * A `?view=` value therefore no longer selects anything here. Rather than
 * silently ignoring it and leaving an old link pointing at content it does not
 * describe, every known value is redirected to where that content moved and
 * anything else is canonicalised away. `needs` and `help` are redirected in
 * next.config.ts before this page renders; what reaches it is canonicalised.
 */
const MOVED: Record<string, string> = {
  // The onboarded-only list became a filter on this page.
  active: "/organisations?onboarded=1",
};

export default async function OrganisationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawView = params.view;
  const view = Array.isArray(rawView) ? rawView[0] : rawView;

  if (view) redirect(MOVED[view] ?? "/organisations");

  const t = await getTranslator();

  return (
    <PageShell>
      <PageHeader
        className="mb-5"
        title={t("organisations_page.title")}
        subtitle={t("organisations_page.subtitle_register")}
      />
      <Suspense fallback={<DirectoryLoading />}>
        <DirectoryView />
      </Suspense>
    </PageShell>
  );
}
