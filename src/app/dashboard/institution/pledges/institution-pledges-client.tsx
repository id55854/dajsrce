"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import {
  Button,
  EmptyState,
  PageHeader,
  PageShell,
  Skeleton,
} from "@/components/ui";
import { timeAgo } from "@/lib/utils";

type PledgeRow = {
  id: string;
  quantity: number;
  amount_eur: number | null;
  created_at: string;
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
 * What has been promised to this organisation.
 *
 * It used to be a small workflow: mark a pledge delivered, then acknowledge
 * it, each step a status the donor then had to interpret. That whole ladder
 * is gone. A promise is a promise; this page reports the ones that stand, and
 * what happens next is settled between the two people involved, not through
 * a state machine.
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

  const body = (
    <>
      {loading ? (
        <ul className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </ul>
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
        <ul className="space-y-3">
          {pledges.map((p) => (
            <li
              key={p.id}
              className="rounded-card border border-border-subtle bg-surface-raised p-4 shadow-raised"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {p.need?.title ?? t("institution.pledges_need")}
                  </p>
                  <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                    <div>
                      <dt className="inline font-medium uppercase tracking-wide text-ink-tertiary">
                        {t("your_pledges.qty_label")}:{" "}
                      </dt>
                      <dd className="inline font-semibold tabular-nums text-ink">{p.quantity}</dd>
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (embedded) return body;

  // No back link. An NGO reaches this page from its own navbar tab, not from
  // the profile, so "back" pointed at a page the visitor had never been on.
  return (
    <PageShell width="content">
      <PageHeader
        title={t("institution.pledges_title")}
        subtitle={t("institution.pledges_subtitle")}
      />

      {body}
    </PageShell>
  );
}
