"use client";

import { Suspense, useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { QuickStartWizard } from "@/components/QuickStartWizard";
import { NeedsClient } from "@/app/needs/needs-client";
import { PageHeader, PageShell, Skeleton } from "@/components/ui";
import { useT } from "@/i18n/client";
import { ActiveView } from "./active-view";
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
const VIEWS = ["active", "register", "needs", "help"] as const;
type View = (typeof VIEWS)[number];

const DEFAULT_VIEW: View = "active";

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stableQuery = searchParams.toString();
  const view = parseView(searchParams.get("view"));

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(stableQuery);
      for (const [key, value] of Object.entries(changes)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const next = params.toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [pathname, router, stableQuery]
  );

  const selectView = useCallback(
    (next: View) => {
      // Switching views drops the previous view's filters rather than carrying
      // a register page number into a needs grid, where it means nothing.
      const params = new URLSearchParams();
      if (next !== DEFAULT_VIEW) params.set("view", next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router]
  );

  const onlyWithNeeds = searchParams.get("withNeeds") === "true";
  const onlyVerified = searchParams.get("verified") === "true";

  const subtitle = useMemo(() => t(`organisations_page.subtitle_${view}`), [t, view]);

  return (
    <PageShell>
      <PageHeader
        className="mb-5"
        title={t("organisations_page.title")}
        subtitle={subtitle}
      />

      <div className="mb-7 overflow-x-auto">
        <div
          role="tablist"
          aria-label={t("organisations_page.views_label")}
          className="inline-flex min-w-full gap-1 rounded-control bg-surface-sunken p-1 sm:min-w-0"
        >
          {VIEWS.map((candidate) => {
            const selected = candidate === view;
            return (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectView(candidate)}
                className={clsx(
                  "min-h-11 flex-1 whitespace-nowrap rounded-control px-4 text-sm font-semibold transition-colors duration-150",
                  "motion-safe:active:scale-[0.98] motion-safe:transition-transform",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                  selected
                    ? "bg-surface-raised text-ink shadow-raised"
                    : "text-ink-secondary hover:text-ink"
                )}
              >
                {t(`organisations_page.view_${candidate}`)}
              </button>
            );
          })}
        </div>
      </div>

      {view === "active" ? (
        <ActiveView
          onlyWithNeeds={onlyWithNeeds}
          onlyVerified={onlyVerified}
          onToggleNeeds={() => setParams({ withNeeds: onlyWithNeeds ? null : "true" })}
          onToggleVerified={() => setParams({ verified: onlyVerified ? null : "true" })}
        />
      ) : view === "register" ? (
        <DirectoryView />
      ) : view === "needs" ? (
        <NeedsClient />
      ) : (
        <QuickStartWizard />
      )}
    </PageShell>
  );
}
