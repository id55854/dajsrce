"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { NewNeedForm } from "@/components/NewNeedForm";
import { CalendarClock, Heart, Plus } from "lucide-react";
import { format, parseISO } from "date-fns";
import { enUS, hr } from "date-fns/locale";
import { useLocale, useT } from "@/i18n/client";
import {
  RosterEmpty,
  RosterFact,
  RosterGroup,
  RosterList,
  RosterPerson,
  RosterPersonDialog,
  RosterSection,
  type RosterPersonDetails,
} from "@/components/Roster";
import type { PersonActivity } from "@/lib/institution-person-activity";
import {
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  PageShell,
  Skeleton,
} from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { DeleteActionButton } from "@/components/YourPledgesSection";

type NeedRow = {
  id: string;
  title: string;
  description?: string | null;
  deadline?: string | null;
  urgency?: string | null;
  quantity_needed?: number | null;
  quantity_pledged?: number | null;
  is_fulfilled?: boolean;
  created_at: string;
};

type PledgeRow = {
  id: string;
  user_id: string;
  need_id: string;
  quantity: number;
  amount_eur: number | null;
  created_at: string;
  donor: { id: string; name: string; email: string };
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
 * Every need this organisation has posted, and what has been promised to
 * each, by whom.
 *
 * It used to be a small workflow: mark a pledge delivered, then acknowledge
 * it, each step a status the donor then had to interpret. That whole ladder
 * is gone. A promise is a promise; this page reports the ones that stand,
 * grouped by need the same way the volunteer roster groups by event. A need
 * nobody has pledged to yet is listed too, so a freshly posted one shows up
 * straight away instead of looking unsaved.
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
  const [needs, setNeeds] = useState<NeedRow[]>([]);
  const [pledges, setPledges] = useState<PledgeRow[]>([]);
  const [activity, setActivity] = useState<Record<string, PersonActivity>>({});
  const [openPerson, setOpenPerson] = useState<RosterPersonDetails | null>(null);
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
      setNeeds(data.needs ?? []);
      setPledges(data.pledges ?? []);
      setActivity(data.activity ?? {});
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
      ) : needs.length === 0 ? (
        <EmptyState title={t("institution.needs_empty")} />
      ) : (
        <div className="space-y-4">
          {needs.map((need) => {
            const rows = byNeed.get(need.id) ?? [];
            const needed = need.quantity_needed ?? null;
            const pledged = need.quantity_pledged ?? rows.reduce((sum, row) => sum + row.quantity, 0);
            return (
              <RosterGroup
                key={need.id}
                icon={<Heart className="h-4 w-4" />}
                tone="brand"
                title={need.title}
                meta={
                  rows.length
                    ? t("institution.pledges_count", { count: rows.length })
                    : t("institution.need_posted", { when: timeAgo(need.created_at, locale) })
                }
                progress={needed ? (pledged / needed) * 100 : null}
                onOpen={() => setOpenNeedId(need.id)}
                openLabel={t("institution.roster_details")}
                count={
                  needed
                    ? t("institution.pledges_fill", { pledged, needed })
                    : t("institution.pledges_total", { pledged })
                }
              >
                {rows.length === 0 ? (
                  <RosterEmpty>{t("institution.need_no_pledges")}</RosterEmpty>
                ) : (
                  <RosterList>
                    {byDonor(rows).map((d) => (
                      <RosterPerson
                        key={d.userId}
                        name={d.donor.name}
                        onOpen={() =>
                          setOpenPerson({
                            name: d.donor.name,
                            email: d.donor.email,
                            pledges: activity[d.userId]?.pledges ?? d.pledges,
                            signups: activity[d.userId]?.signups ?? 0,
                            since: t("institution.person_pledged", { when: timeAgo(d.latest, locale) }),
                          })
                        }
                        aside={
                          <span className="text-sm font-semibold tabular-nums text-ink">
                            {t("institution.pledge_qty", { qty: d.quantity })}
                          </span>
                        }
                      />
                    ))}
                  </RosterList>
                )}
              </RosterGroup>
            );
          })}
        </div>
      )}
      <RosterPersonDialog
        person={openPerson}
        onClose={() => setOpenPerson(null)}
        labels={{
          close: t("common.close"),
          email: t("dashboard_individual.email_label"),
          pledges: t("institution.person_pledges"),
          signups: t("institution.person_signups"),
        }}
      />
      <NeedDetailsDialog
        need={needs.find((need) => need.id === openNeedId) ?? null}
        rows={openNeedId ? byNeed.get(openNeedId) ?? [] : []}
        onClose={() => setOpenNeedId(null)}
        onDeleted={(id) => {
          setOpenNeedId(null);
          setNeeds((current) => current.filter((need) => need.id !== id));
          setPledges((current) => current.filter((pledge) => pledge.need_id !== id));
        }}
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

function NeedDetailsDialog({ need, rows, onClose, onDeleted }: {
  need: NeedRow | null;
  rows: PledgeRow[];
  onClose: () => void;
  onDeleted: (needId: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
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
      footer={
        <DeleteActionButton
          endpoint={`/api/needs/${need.id}`}
          label={t("institution.need_delete")}
          title={t("institution.need_delete_title")}
          description={
            rows.length
              ? t("institution.need_delete_body_pledges", { count: rows.length })
              : t("institution.need_delete_body")
          }
          confirmLabel={t("institution.need_delete_confirm")}
          successTitle={t("institution.need_delete_success")}
          errorTitle={t("institution.need_delete_error")}
          conflictDescription={t("common.error_generic")}
          onDeleted={() => onDeleted(need.id)}
        />
      }
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
