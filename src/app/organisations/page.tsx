"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { QuickStartWizard } from "@/components/QuickStartWizard";
import { NeedsClient } from "@/app/needs/needs-client";
import { PageHeader, PageShell, Skeleton } from "@/components/ui";
import { useT } from "@/i18n/client";
import { DirectoryLoading, DirectoryView } from "./directory-view";

/**
 * One page for finding an organisation.
 *
 * This used to be three separate navigation entries answering three halves of
 * the same question — a 43,703-row official register, a grid of open needs,
 * and a "find help" wizard — so a visitor had to guess which tab held the
 * thing they wanted, and the register gave no hint that only a fraction of
 * those associations can actually be reached here.
 *
 * The views share one heading and one URL. `?view=` is the only new state, and
 * the register keeps its own address (`/organisations`) so the 43,703 detail
 * pages beneath it keep their inbound links.
 */
const VIEWS = ["register", "needs", "help"] as const;
type View = (typeof VIEWS)[number];

const DEFAULT_VIEW: View = "register";

function parseView(raw: string | null): View {
  return VIEWS.includes(raw as View) ? (raw as View) : DEFAULT_VIEW;
}

export default function OrganisationsPage() {
  return (
    <Suspense fallback={<OrganisationsLoading />}>
      <OrganisationsExperience />
    </Suspense>
  );
}

function OrganisationsLoading() {
  return (
    <PageShell>
      <div className="mb-8">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="mt-4 h-5 w-full max-w-3xl" />
      </div>
      <DirectoryLoading />
    </PageShell>
  );
}

function OrganisationsExperience() {
  const t = useT();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get("view"));

  const subtitle = useMemo(() => t(`organisations_page.subtitle_${view}`), [t, view]);

  return (
    <PageShell>
      <PageHeader
        className="mb-5"
        title={t("organisations_page.title")}
        subtitle={subtitle}
      />

      {view === "register" ? (
        <DirectoryView />
      ) : view === "needs" ? (
        <NeedsClient />
      ) : (
        <QuickStartWizard />
      )}
    </PageShell>
  );
}
