import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageHeader, PageShell } from "@/components/ui";
import { getTranslator } from "@/i18n/server";
import { DirectoryLoading, DirectoryView } from "./directory-view";

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
 * anything else is canonicalised away.
 */
const MOVED: Record<string, string> = {
  needs: "/doniraj",
  help: "/doniraj?view=explore",
  // The onboarded-only list is becoming a filter on this page; until that
  // filter ships, the register itself is the honest destination.
  active: "/organisations",
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
