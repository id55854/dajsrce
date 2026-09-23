"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { NewNeedForm } from "@/components/NewNeedForm";
import { Plus } from "lucide-react";
import { useT } from "@/i18n/client";
import { RosterGrid, RosterGroup, RosterPerson } from "@/components/Roster";
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
  user_id: string;
  need_id: string;
  quantity: number;
  amount_eur: number | null;
  created_at: string;
  donor: { id: string; name: string; email: string };
  need: { title: string; quantity_needed?: number | null; quantity_pledged?: number | null } | null;
};

type InstitutionPledgesClientProps = {
  /**
   * True when rendered inside the NGO profile's own tab strip, which already
   * supplies the page shell and the heading. Its own route keeps both so a
   * direct link to /dashboard/institution/pledges still works.
   */
  embedded?: boolean;
  refreshKey?: number;
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
export function InstitutionPledgesClient({ embedded = false, refreshKey = 0 }: InstitutionPledgesClientProps) {
  const t = useT();
  const panelId = useId();
  const [publishing, setPublishing] = useState(false);
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
  }, [load, refreshKey]);

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
        <div className="space-y-4">
          {Array.from(byNeed.entries()).map(([needId, rows]) => {
            const need = rows[0]?.need;
            const needed = need?.quantity_needed ?? null;
            const pledged = need?.quantity_pledged ?? rows.reduce((sum, row) => sum + row.quantity, 0);
            return (
              <RosterGroup
                key={needId}
                title={need?.title ?? t("institution.pledges_need")}
                meta={t("institution.pledges_count", { count: rows.length })}
                count={
                  needed
                    ? t("institution.pledges_fill", { pledged, needed })
                    : t("institution.pledges_total", { pledged })
                }
              >
                <RosterGrid>
                  {rows.map((p) => (
                    <RosterPerson
                      key={p.id}
                      name={p.donor.name}
                      email={p.donor.email}
                      when={p.created_at}
                      whenLabel={timeAgo(p.created_at)}
                      aside={
                        <>
                          <p className="text-sm font-semibold tabular-nums text-ink">
                            {t("institution.pledge_qty", { qty: p.quantity })}
                          </p>
                          {p.amount_eur != null ? (
                            <p className="text-xs tabular-nums text-ink-tertiary">
                              {`€${Number(p.amount_eur).toFixed(2)}`}
                            </p>
                          ) : null}
                        </>
                      }
                    />
                  ))}
                </RosterGrid>
              </RosterGroup>
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
        actions={<Button onClick={() => setPublishing((value) => !value)} aria-expanded={publishing} aria-controls={panelId} icon={<Plus className="h-4 w-4" aria-hidden />}>{t("institution.dashboard_new_need")}</Button>}
      />

      {publishing ? <div className="mb-6"><NewNeedForm panelId={panelId} onClose={() => setPublishing(false)} onPosted={() => void load()} /></div> : null}
      {body}
    </PageShell>
  );
}
