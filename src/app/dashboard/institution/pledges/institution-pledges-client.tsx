"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  PageShell,
  Skeleton,
} from "@/components/ui";
import { timeAgo } from "@/lib/utils";

type PledgeRow = {
  id: string;
  user_id: string;
  need_id: string;
  quantity: number;
  amount_eur: number | null;
  created_at: string;
  donor: { id: string; name: string; email: string };
  need: { title: string } | null;
};

type InstitutionPledgesClientProps = {
  /**
   * True when rendered inside the NGO profile's own tab strip, which already
   * supplies the page shell and the heading. Its own route keeps both so a
   * direct link to /dashboard/institution/pledges still works.
   */
  embedded?: boolean;
};

/**
 * What has been promised to this organisation, and by whom.
 *
 * It used to be a small workflow: mark a pledge delivered, then acknowledge
 * it, each step a status the donor then had to interpret. That whole ladder
 * is gone. A promise is a promise; this page reports the ones that stand,
 * grouped by need the same way the volunteer roster groups by event, so an
 * organisation can see who to actually expect a donation from.
 */
export function InstitutionPledgesClient({ embedded = false }: InstitutionPledgesClientProps) {
  const t = useT();
  const [pledges, setPledges] = useState<PledgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/institution/pledges", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(typeof data.error === "string" ? data.error : t("common.error_generic"));
        return;
      }
      setLoadError(null);
      setPledges(data.pledges ?? []);
    } catch {
      setLoadError(t("common.error_generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const byNeed = new Map<string, PledgeRow[]>();
  for (const p of pledges) {
    const arr = byNeed.get(p.need_id) ?? [];
    arr.push(p);
    byNeed.set(p.need_id, arr);
  }

  const body = (
    <>
      {loading ? (
        <div className="space-y-4" aria-busy="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-48 rounded-card" />
          ))}
        </div>
      ) : loadError ? (
        <EmptyState
          title={t("errors.generic_title")}
          description={loadError}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              {t("errors.retry")}
            </Button>
          }
        />
      ) : pledges.length === 0 ? (
        <EmptyState title={t("institution.pledges_empty")} />
      ) : (
        <div className="space-y-6">
          {Array.from(byNeed.entries()).map(([needId, rows]) => {
            const need = rows[0]?.need;
            return (
              <Card key={needId} padding="none">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-subtle p-5">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-ink">
                      {need?.title ?? t("institution.pledges_need")}
                    </h2>
                  </div>
                  <p className="shrink-0 text-sm text-ink-secondary">
                    {t("institution.pledges_count", { count: rows.length })}
                  </p>
                </div>

                <ul className="divide-y divide-border-subtle">
                  {rows.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{p.donor.name}</p>
                        <p className="truncate text-sm text-ink-secondary">{p.donor.email}</p>
                        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                          <div>
                            <dt className="inline font-medium uppercase tracking-wide text-ink-tertiary">
                              {t("your_pledges.qty_label")}:{" "}
                            </dt>
                            <dd className="inline font-semibold tabular-nums text-ink">
                              {p.quantity}
                            </dd>
                          </div>
                          {p.amount_eur != null ? (
                            <div>
                              <dt className="inline font-medium uppercase tracking-wide text-ink-tertiary">
                                {t("institution.pledges_amount")}:{" "}
                              </dt>
                              <dd className="inline font-semibold tabular-nums text-ink">
                                {`€${Number(p.amount_eur).toFixed(2)}`}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>
                      <time
                        dateTime={p.created_at}
                        className="shrink-0 text-xs text-ink-tertiary"
                      >
                        {timeAgo(p.created_at)}
                      </time>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );

  if (embedded) return body;

  // No back link. An NGO reaches this page from its own navbar tab, not from
  // the profile, so "back" pointed at a page the visitor had never been on.
  return (
    <PageShell width="wide">
      <PageHeader
        title={t("institution.pledges_title")}
        subtitle={t("institution.pledges_subtitle")}
      />

      {body}
    </PageShell>
  );
}
