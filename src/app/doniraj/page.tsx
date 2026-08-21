"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HandHeart } from "lucide-react";
import { QuickStartWizard } from "@/components/QuickStartWizard";
import { NeedsClient } from "@/app/needs/needs-client";
import { Card, PageHeader, PageShell, Skeleton, buttonClasses } from "@/components/ui";
import { useT } from "@/i18n/client";

/**
 * One page for giving.
 *
 * Pledging against a published need and working out what you could give in the
 * first place are two halves of the same intent, so they share one address and
 * one heading instead of two top-level tabs. Offering a specific item stays on
 * its own route: an offer belongs to a private individual and that route is
 * deliberately kept out of search indexes.
 */
const VIEWS = ["needs", "explore"] as const;
type View = (typeof VIEWS)[number];

const DEFAULT_VIEW: View = "needs";

function parseView(raw: string | null): View {
  return VIEWS.includes(raw as View) ? (raw as View) : DEFAULT_VIEW;
}

export default function DonatePage() {
  return (
    <Suspense fallback={<DonateLoading />}>
      <DonateExperience />
    </Suspense>
  );
}

function DonateLoading() {
  return (
    <PageShell>
      <div className="mb-8">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="mt-4 h-5 w-full max-w-2xl" />
      </div>
      <Skeleton className="h-64 w-full" />
    </PageShell>
  );
}

function DonateExperience() {
  const t = useT();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get("view"));

  const subtitle = useMemo(() => t(`donate_page.subtitle_${view}`), [t, view]);

  return (
    <PageShell>
      <PageHeader className="mb-5" title={t("donate_page.title")} subtitle={subtitle} />

      <nav aria-label={t("donate_page.views_label")} className="mb-6 flex flex-wrap gap-2">
        {VIEWS.map((candidate) => {
          const active = candidate === view;
          return (
            <Link
              key={candidate}
              href={candidate === DEFAULT_VIEW ? "/doniraj" : `/doniraj?view=${candidate}`}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-full border border-border-subtle px-4 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
              }
            >
              {t(`donate_page.view_${candidate}`)}
            </Link>
          );
        })}
      </nav>

      {view === "needs" ? <NeedsClient /> : <QuickStartWizard />}

      {/* Offering a specific item is the third way to give. It keeps its own
          route because the offer itself is personal data. */}
      <Card className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <HandHeart className="h-4 w-4 text-brand" aria-hidden />
            {t("donate_page.offer_cta_title")}
          </p>
          <p className="mt-1 text-sm text-ink-secondary">
            {t("donate_page.offer_cta_body")}
          </p>
        </div>
        <Link href="/offers" className={buttonClasses({ size: "sm", variant: "secondary" })}>
          {t("donate_page.offer_cta_action")}
        </Link>
      </Card>
    </PageShell>
  );
}
