"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { NewNeedForm } from "@/components/NewNeedForm";
import { CalendarClock, Plus } from "lucide-react";
import { format, parseISO } from "date-fns";
import { enUS, hr } from "date-fns/locale";
import { useLocale, useT } from "@/i18n/client";
import { RosterFact, RosterGroup, RosterList, RosterPerson, RosterSection } from "@/components/Roster";
import {
  Button,
  Dialog,
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
  need: {
    title: string;
    description?: string | null;
    deadline?: string | null;
    urgency?: string | null;
    quantity_needed?: number | null;
    quantity_pledged?: number | null;
  } | null;
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
/**
 * One row per donor within a need: several pledges from the same person read
 * as one promise of the combined quantity, dated by the latest.
 */
type DonorRow = {
  userId: string;
  donor: PledgeRow["donor"];
  quantity: number;
  amountEur: number | null;
  pledges: number;
  latest: string;
};

function byDonor(rows: PledgeRow[]): DonorRow[] {
  const donors = new Map<string, DonorRow>();
  for (const row of rows) {
    const current = donors.get(row.user_id);
    if (!current) {
      donors.set(row.user_id, {
        userId: row.user_id,
        donor: row.donor,
        quantity: row.quantity,
        amountEur: row.amount_eur,
        pledges: 1,
        latest: row.created_at,
      });
      continue;
    }
    current.quantity += row.quantity;
    current.pledges += 1;
    if (row.amount_eur != null) current.amountEur = (current.amountEur ?? 0) + Number(row.amount_eur);
    if (row.created_at > current.latest) current.latest = row.created_at;
  }
  return [...donors.values()].sort((a, b) => b.latest.localeCompare(a.latest));
}

export function InstitutionPledgesClient({ embedded = false, refreshKey = 0 }: InstitutionPledgesClientProps) {
  const t = useT();
  const { locale } = useLocale();
  const panelId = useId();
  const [publishing, setPublishing] = useState(false);
  const [pledges, setPledges] = useState<PledgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The need whose details are open; the roster header opens it. */
  const [openNeedId, setOpenNeedId] = useState<string | null>(null);

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
                progress={needed ? (pledged / needed) * 100 : null}
                onOpen={need ? () => setOpenNeedId(needId) : undefined}
                openLabel={t("institution.roster_details")}
                count={
                  needed
                    ? t("institution.pledges_fill", { pledged, needed })
                    : t("institution.pledges_total", { pledged })
                }
              >
                <RosterList>
                  {byDonor(rows).map((d) => (
                    <RosterPerson
                      key={d.userId}
                      name={d.donor.name}
                      email={d.donor.email}
                      when={d.latest}
                      whenLabel={timeAgo(d.latest, locale)}
                      note={d.pledges > 1 ? t("institution.pledges_count", { count: d.pledges }) : null}
                      aside={
                        <>
                          <p className="text-base font-semibold tabular-nums text-ink">{d.quantity}</p>
                          <p className="text-xs text-ink-tertiary">
                            {d.amountEur != null ? `€${Number(d.amountEur).toFixed(2)}` : t("institution.roster_quantity")}
                          </p>
                        </>
                      }
                    />
                  ))}
                </RosterList>
              </RosterGroup>
            );
          })}
        </div>
      )}
      <NeedDetailsDialog
        rows={openNeedId ? byNeed.get(openNeedId) ?? [] : []}
        onClose={() => setOpenNeedId(null)}
      />
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

function NeedDetailsDialog({ rows, onClose }: { rows: PledgeRow[]; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const need = rows[0]?.need;
  if (!need) return null;
  const needed = need.quantity_needed ?? null;
  const pledged = need.quantity_pledged ?? rows.reduce((sum, row) => sum + row.quantity, 0);
  const deadline = need.deadline
    ? format(parseISO(need.deadline.slice(0, 10)), "EEEE, d. MMMM yyyy.", { locale: locale === "hr" ? hr : enUS })
    : null;
  const urgencyKey = need.urgency === "urgent"
    ? "need_card.urgent"
    : need.urgency === "needed_soon"
      ? "need_card.needed_soon"
      : need.urgency === "routine"
        ? "need_card.routine"
        : null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={need.title}
      description={needed ? t("institution.pledges_fill", { pledged, needed }) : t("institution.pledges_total", { pledged })}
      closeLabel={t("common.close")}
      variant="sheet-on-mobile"
    >
      <div className="space-y-5">
        {deadline || urgencyKey ? (
          <dl className="space-y-2.5 text-sm">
            <RosterFact icon={<CalendarClock className="h-4 w-4" aria-hidden />} label={t("institution.roster_deadline")}>
              {deadline ?? t("institution.roster_no_deadline")}
              {urgencyKey ? <span className="block text-ink-secondary">{t(urgencyKey)}</span> : null}
            </RosterFact>
          </dl>
        ) : null}
        {need.description ? (
          <RosterSection title={t("profile_calendar.about_need")}>{need.description}</RosterSection>
        ) : (
          <p className="text-sm text-ink-tertiary">{t("institution.roster_no_description")}</p>
        )}
      </div>
    </Dialog>
  );
}
