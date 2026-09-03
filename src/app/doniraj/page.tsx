"use client";

import { Suspense, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { QuickStartWizard } from "@/components/QuickStartWizard";
import { NeedsClient } from "@/app/needs/needs-client";
import { NewNeedForm } from "@/components/NewNeedForm";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Button, Card, PageHeader, PageShell, Skeleton } from "@/components/ui";
import { useT } from "@/i18n/client";

/**
 * One page for giving.
 *
 * Pledging against a published need and working out what you could give in the
 * first place are two halves of the same intent, so they share one address and
 * one heading instead of two top-level tabs.
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
  const needPanelId = useId();

  const subtitle = useMemo(() => t(`donate_page.subtitle_${view}`), [t, view]);

  // An NGO account can already post a need from its own dashboard. This tab
  // is where a donor looks for one, so offering the same shortcut here saves
  // the round trip, but only once the account's role is actually known, not
  // by guessing from a flag a request could forge.
  const [isNgo, setIsNgo] = useState(false);
  const [needFormOpen, setNeedFormOpen] = useState(false);
  const [needsRefreshKey, setNeedsRefreshKey] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      fetch("/api/me", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((json: { profile?: { role: string } } | null) => {
          if (!cancelled && json?.profile?.role === "ngo") setIsNgo(true);
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

      {isNgo ? (
        <div className="mb-6">
          {needFormOpen ? (
            <NewNeedForm
              panelId={needPanelId}
              onClose={() => setNeedFormOpen(false)}
              onPosted={() => setNeedsRefreshKey((k) => k + 1)}
            />
          ) : (
            <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {t("donate_page.ngo_new_need_title")}
                </p>
                <p className="mt-1 text-sm text-ink-secondary">
                  {t("donate_page.ngo_new_need_body")}
                </p>
              </div>
              <Button
                size="sm"
                aria-expanded={needFormOpen}
                aria-controls={needPanelId}
                onClick={() => setNeedFormOpen(true)}
                icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              >
                {t("donate_page.ngo_new_need_action")}
              </Button>
            </Card>
          )}
        </div>
      ) : null}

      {view === "needs" ? <NeedsClient refreshKey={needsRefreshKey} /> : <QuickStartWizard />}
    </PageShell>
  );
}
