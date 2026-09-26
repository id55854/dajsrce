"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { NewNeedForm, type EditableNeed, type SavedNeed } from "@/components/NewNeedForm";
import {
  CalendarClock,
  CircleCheck,
  Heart,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { enUS, hr } from "date-fns/locale";
import { useLocale, useT } from "@/i18n/client";
import {
  RosterEmpty,
  RosterFact,
  RosterGroup,
  RosterList,
  RosterPerson,
  RosterSection,
} from "@/components/Roster";
import {
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  PageShell,
  Skeleton,
  useToast,
} from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { needErrorKey } from "@/lib/need-patch";
import { DeleteActionButton } from "@/components/YourPledgesSection";

type NeedRow = {
  id: string;
  title: string;
  description?: string | null;
  donation_type?: string | null;
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
  /** The donor's note to the organisation, written with the pledge. */
  message?: string | null;
  created_at: string;
  donor: { id: string; name: string | null; email: string };
};

type InstitutionPledgesClientProps = {
  /**
   * True when rendered inside the NGO profile's own tab strip, which already
   * supplies the page shell and the heading. Its own route keeps both so a
   * direct link to /dashboard/institution/pledges still works.
   */
  embedded?: boolean;
  refreshKey?: number;
  /** A need was edited, closed, reopened or deleted (e.g. to refresh the calendar). */
  onChanged?: () => void;
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
  hasMessage: boolean;
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
        hasMessage: Boolean(row.message?.trim()),
      });
      continue;
    }
    current.quantity += row.quantity;
    current.pledges += 1;
    current.hasMessage ||= Boolean(row.message?.trim());
    if (row.amount_eur != null) current.amountEur = (current.amountEur ?? 0) + Number(row.amount_eur);
    if (row.created_at > current.latest) current.latest = row.created_at;
  }
  return [...donors.values()].sort((a, b) => b.latest.localeCompare(a.latest));
}

export function InstitutionPledgesClient({
  embedded = false,
  refreshKey = 0,
  onChanged,
}: InstitutionPledgesClientProps) {
  const t = useT();
  const { locale } = useLocale();
  const panelId = useId();
  const editPanelId = useId();
  const [publishing, setPublishing] = useState(false);
  const [needs, setNeeds] = useState<NeedRow[]>([]);
  const [pledges, setPledges] = useState<PledgeRow[]>([]);
  const [openDonorId, setOpenDonorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The need whose details are open; the roster header opens it. */
  const [openNeedId, setOpenNeedId] = useState<string | null>(null);
  /** The need being corrected in the edit panel above the list. */
  const [editingNeed, setEditingNeed] = useState<NeedRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/institution/pledges", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(t("common.error_generic"));
        return;
      }
      setLoadError(null);
      setNeeds(data.needs ?? []);
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

  useEffect(() => {
    if (editingNeed) document.getElementById(editPanelId)?.scrollIntoView({ block: "start" });
  }, [editingNeed, editPanelId]);

  const applySavedNeed = (saved: SavedNeed) => {
    setNeeds((current) =>
      current.map((need) =>
        need.id === saved.id
          ? {
              ...need,
              title: saved.title,
              description: saved.description,
              urgency: saved.urgency,
              quantity_needed: saved.quantity_needed,
              quantity_pledged: saved.quantity_pledged,
              deadline: saved.deadline,
              is_fulfilled: saved.is_fulfilled,
            }
          : need
      )
    );
    onChanged?.();
  };

  const byNeed = new Map<string, PledgeRow[]>();
  for (const p of pledges) {
    const arr = byNeed.get(p.need_id) ?? [];
    arr.push(p);
    byNeed.set(p.need_id, arr);
  }

  const donorName = (donor: PledgeRow["donor"]) => donor.name?.trim() || t("institution.donor_unknown");

  const body = (
    <>
      {editingNeed ? (
        <div className="mb-6">
          <NewNeedForm
            key={editingNeed.id}
            panelId={editPanelId}
            need={editingNeed as EditableNeed}
            onClose={() => setEditingNeed(null)}
            onSaved={applySavedNeed}
          />
        </div>
      ) : null}
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
            const posted = rows.length
              ? t("institution.pledges_count", { count: rows.length })
              : t("institution.need_posted", { when: timeAgo(need.created_at, locale) });
            return (
              <RosterGroup
                key={need.id}
                icon={<Heart className="h-4 w-4" />}
                tone="brand"
                title={need.title}
                meta={need.is_fulfilled ? `${t("institution.need_closed")} · ${posted}` : posted}
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
                        name={donorName(d.donor)}
                        onOpen={() => setOpenDonorId(d.userId)}
                        aside={
                          <span className="inline-flex items-center gap-2 text-sm font-semibold tabular-nums text-ink">
                            {d.hasMessage ? (
                              <span className="inline-flex text-ink-tertiary">
                                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                                <span className="sr-only">{t("institution.donor_has_message")}</span>
                              </span>
                            ) : null}
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
      <DonorDialog
        userId={openDonorId}
        pledges={pledges}
        needs={needs}
        name={(donor) => donorName(donor)}
        onClose={() => setOpenDonorId(null)}
      />
      <NeedDetailsDialog
        need={needs.find((need) => need.id === openNeedId) ?? null}
        rows={openNeedId ? byNeed.get(openNeedId) ?? [] : []}
        donorName={donorName}
        onClose={() => setOpenNeedId(null)}
        onEdit={(need) => {
          setOpenNeedId(null);
          setEditingNeed(need);
        }}
        onUpdated={applySavedNeed}
        onDeleted={(id) => {
          setOpenNeedId(null);
          if (editingNeed?.id === id) setEditingNeed(null);
          setNeeds((current) => current.filter((need) => need.id !== id));
          setPledges((current) => current.filter((pledge) => pledge.need_id !== id));
          onChanged?.();
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

/**
 * Who a donor is to this organisation: how to reach them, what they promised
 * it and what they wrote. Deliberately nothing about their activity with
 * anyone else; that is not this organisation's business.
 */
function DonorDialog({
  userId,
  pledges,
  needs,
  name,
  onClose,
}: {
  userId: string | null;
  pledges: PledgeRow[];
  needs: NeedRow[];
  name: (donor: PledgeRow["donor"]) => string;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  if (!userId) return null;
  const rows = pledges
    .filter((pledge) => pledge.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (rows.length === 0) return null;
  const donor = rows[0].donor;
  const titles = new Map(needs.map((need) => [need.id, need.title]));
  return (
    <Dialog
      open
      onClose={onClose}
      title={name(donor)}
      description={t("institution.person_pledged", { when: timeAgo(rows[0].created_at, locale) })}
      closeLabel={t("common.close")}
      variant="sheet-on-mobile"
    >
      <div className="space-y-4 text-sm">
        {donor.email ? (
          <dl>
            <dt className="text-xs text-ink-tertiary">{t("dashboard_individual.email_label")}</dt>
            <dd>
              <a href={`mailto:${donor.email}`} className="break-all text-brand underline-offset-2 hover:underline">
                {donor.email}
              </a>
            </dd>
          </dl>
        ) : null}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
            {t("institution.donor_pledged_to_you")}
          </h3>
          <ul className="mt-1 divide-y divide-border-subtle">
            {rows.map((row) => (
              <li key={row.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 font-medium text-ink">{titles.get(row.need_id) ?? "—"}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-ink">
                    {t("institution.pledge_qty", { qty: row.quantity })}
                  </span>
                </div>
                <p className="text-xs text-ink-tertiary">{timeAgo(row.created_at, locale)}</p>
                {row.message?.trim() ? (
                  <blockquote
                    aria-label={t("institution.donor_message")}
                    className="mt-1.5 whitespace-pre-line rounded-control bg-surface-sunken px-3 py-2 text-ink"
                  >
                    {row.message.trim()}
                  </blockquote>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}

function NeedDetailsDialog({ need, rows, donorName, onClose, onEdit, onUpdated, onDeleted }: {
  need: NeedRow | null;
  rows: PledgeRow[];
  donorName: (donor: PledgeRow["donor"]) => string;
  onClose: () => void;
  onEdit: (need: NeedRow) => void;
  onUpdated: (need: SavedNeed) => void;
  onDeleted: (needId: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const [toggling, setToggling] = useState(false);
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
  const messages = rows.filter((row) => row.message?.trim());
  const closed = Boolean(need.is_fulfilled);

  // Closing takes the need off the public lists without touching the
  // pledges already made; reopening puts it back.
  async function toggleClosed(current: NeedRow) {
    setToggling(true);
    try {
      const res = await fetch(`/api/needs/${current.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_fulfilled: !closed }),
      });
      const json = (await res.json().catch(() => ({}))) as { need?: SavedNeed; code?: string; field?: string };
      if (!res.ok || !json.need) {
        toast({
          tone: "error",
          title: t(closed ? "institution.need_reopen_error" : "institution.need_close_error"),
          description: t(needErrorKey({ status: res.ok ? 500 : res.status, code: json.code, field: json.field }, "update")),
        });
        return;
      }
      onUpdated(json.need);
      toast({
        tone: "success",
        title: t(json.need.is_fulfilled ? "institution.need_closed_toast" : "institution.need_reopened_toast"),
      });
    } catch {
      toast({ tone: "error", title: t("institution.need_update_failed") });
    } finally {
      setToggling(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={need.title}
      description={needed ? t("institution.pledges_fill", { pledged, needed }) : t("institution.pledges_total", { pledged })}
      closeLabel={t("common.close")}
      variant="sheet-on-mobile"
      footer={
        // Three actions do not fit one row of the dialog, so they wrap.
        <div className="flex w-full flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => onEdit(need)}
            icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
          >
            {t("common.edit")}
          </Button>
          <Button
            variant="secondary"
            loading={toggling}
            onClick={() => void toggleClosed(need)}
            icon={
              closed ? (
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              ) : (
                <CircleCheck className="h-4 w-4" aria-hidden="true" />
              )
            }
          >
            {closed ? t("institution.need_reopen") : t("institution.need_close")}
          </Button>
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
        </div>
      }
    >
      <div className="space-y-5">
        {closed ? (
          <p className="rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-secondary">
            {t("institution.need_closed_notice")}
          </p>
        ) : null}
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
        {messages.length > 0 ? (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
              {t("institution.donor_messages")}
            </h3>
            <ul className="mt-1.5 space-y-2">
              {messages.map((row) => (
                <li key={row.id} className="rounded-control bg-surface-sunken px-3 py-2 text-sm">
                  <p className="font-medium text-ink">
                    {donorName(row.donor)}{" "}
                    <span className="font-normal text-ink-tertiary">· {timeAgo(row.created_at, locale)}</span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-line text-ink">{row.message!.trim()}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}
