"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { enUS, hr } from "date-fns/locale";
import { CalendarHeart, Clock, Heart, MapPin } from "lucide-react";
import type { AuthProfile } from "@/lib/auth/profile";
import type { Pledge, Shipment } from "@/lib/types";
import { DONATION_TYPES } from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";
import { createClient } from "@/lib/supabase/client";
import { CancelActionButton } from "@/components/YourPledgesSection";
import { FilterChip } from "@/components/FilterBar";
import type { AppRole } from "@/lib/auth/roles";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  PageShell,
  SectionHeader,
  Skeleton,
  Stat,
  buttonClasses,
} from "@/components/ui";
import type { BadgeTone } from "@/components/ui";

type PledgeRow = Pledge & {
  need?: {
    id: string;
    title: string;
    donation_type: string;
    institution?: { id: string; name: string; category: string };
  };
  shipment?: Shipment | null;
};

/**
 * The volunteer's own signups. Read directly under RLS ("Users can view own
 * active signups") with an explicit column list and a hard cap, because this
 * surface needs the signup id — the id the cancel endpoint is keyed by — and
 * the event it belongs to, which the shared list endpoint does not project.
 */
type SignupEvent = {
  id: string;
  title: string;
  event_date: string;
  start_time: string | null;
};

type SignupRow = {
  id: string;
  event_id: string;
  created_at: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  event: SignupEvent | null;
};

const SIGNUP_LIMIT = 20;

/**
 * PostgREST answers a to-one embed with an object, but the untyped client
 * models every embed as a list. Accept both rather than trusting one.
 */
function toSignupRow(
  row: Omit<SignupRow, "event"> & { event: SignupEvent | SignupEvent[] | null }
): SignupRow {
  return {
    ...row,
    event: Array.isArray(row.event) ? row.event[0] ?? null : row.event,
  };
}

/** The same status vocabulary the map surface uses (`YourPledgesSection`). */
const STATUS: Record<string, { tone: BadgeTone; key: string }> = {
  pledged: { tone: "warning", key: "your_pledges.status_pledged" },
  delivered: { tone: "info", key: "your_pledges.status_delivered" },
  confirmed: { tone: "success", key: "your_pledges.status_confirmed" },
  cancelled: { tone: "neutral", key: "your_pledges.status_cancelled" },
};

/**
 * Status filter chips, in the same order the lifecycle usually runs.
 * `confirmed` is left off the filter row by design — a confirmed pledge
 * still shows (and badges as such) under "Sve", it just isn't a state
 * worth a dedicated filter here.
 */
const STATUS_FILTERS: readonly PledgeRow["status"][] = [
  "pledged",
  "delivered",
  "cancelled",
];

function roleTranslationKey(role: AppRole): string {
  if (role === "ngo") return "dashboard_individual.role_ngo";
  if (role === "company") return "dashboard_individual.role_company";
  if (role === "superadmin") return "dashboard_individual.role_superadmin";
  return "dashboard_individual.role_individual";
}

export function IndividualDashboardClient({ profile }: { profile: AuthProfile }) {
  const t = useT();
  const { locale } = useLocale();
  const dateLocale = locale === "hr" ? hr : enUS;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pledges, setPledges] = useState<PledgeRow[]>([]);
  const [signups, setSignups] = useState<SignupRow[]>([]);
  const [signupsLoading, setSignupsLoading] = useState(true);
  const [signupsError, setSignupsError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [statusFilter, setStatusFilter] = useState<PledgeRow["status"] | "all">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pledges", { credentials: "include" });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(typeof json.error === "string" ? json.error : t("common.error_generic"));
          return;
        }
        setLoadError(null);
        setPledges(json.pledges ?? []);
      } catch {
        if (!cancelled) setLoadError(t("common.error_generic"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("volunteer_signups")
          .select(
            "id, event_id, created_at, checked_in_at, checked_out_at, event:volunteer_events(id, title, event_date, start_time)"
          )
          .eq("user_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(SIGNUP_LIMIT);
        if (cancelled) return;
        if (error) {
          setSignupsError(t("common.error_generic"));
          return;
        }
        setSignupsError(null);
        setSignups((data ?? []).map(toSignupRow));
      } catch {
        if (!cancelled) setSignupsError(t("common.error_generic"));
      } finally {
        if (!cancelled) setSignupsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.id, reload, t]);

  // The status filter narrows the list below only — the stat tiles above
  // report the whole account regardless of what's currently filtered.
  const filteredPledges =
    statusFilter === "all"
      ? pledges
      : pledges.filter((item) => item.status === statusFilter);
  const recent = filteredPledges.slice(0, 8);
  // A withdrawn pledge is not a donation, so it must not inflate the count.
  const active = pledges.filter((item) => item.status !== "cancelled").length;

  return (
    <PageShell width="content">
      <PageHeader
        title={t("dashboard_individual.title")}
        subtitle={t("dashboard_individual.subtitle")}
        actions={
          <Link href="/map" className={buttonClasses()}>
            <MapPin className="h-4 w-4" aria-hidden="true" />
            {t("dashboard_individual.find_places")}
          </Link>
        }
      />

      <div className="space-y-8">
        <Card padding="lg" aria-labelledby="account-heading">
          <SectionHeader
            title={
              <span id="account-heading">{t("dashboard_individual.your_account")}</span>
            }
          />
          <p className="text-lg font-semibold text-ink">{profile.name}</p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
                {t("dashboard_individual.email_label")}
              </dt>
              <dd className="mt-0.5 break-all text-base text-ink">{profile.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
                {t("dashboard_individual.role_label")}
              </dt>
              <dd className="mt-0.5 text-base text-ink">{t(roleTranslationKey(profile.role))}</dd>
            </div>
          </dl>
        </Card>

        <section className="grid gap-4 sm:grid-cols-2">
          <Stat
            icon={<Heart className="h-4 w-4" aria-hidden="true" />}
            label={t("dashboard_individual.stat_donations")}
            value={loading ? <Skeleton className="h-8 w-12" /> : active}
          />
          {/* This was a hardcoded `0` presented as a measurement. There is no
              volunteer-hours query on this surface yet, so it shows an em-dash
              in the muted tone rather than a fabricated figure. A localised
              "not available yet" caption needs a translation key that does not
              exist yet — see the handover note. */}
          <Stat
            icon={<Clock className="h-4 w-4" aria-hidden="true" />}
            label={t("dashboard_individual.stat_volunteer_hours")}
            tone="muted"
            value="—"
          />
        </section>

        <section>
          <SectionHeader title={t("dashboard_individual.donation_history")} />
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
                    setReload((n) => n + 1);
                  }}
                >
                  {t("errors.retry")}
                </Button>
              }
            />
          ) : pledges.length === 0 ? (
            <EmptyState
              title={t("dashboard_individual.no_actions")}
              action={
                <Link href="/map" className={buttonClasses({ variant: "secondary" })}>
                  {t("dashboard_individual.find_places")}
                </Link>
              }
            />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                <FilterChip
                  aria-pressed={statusFilter === "all"}
                  onClick={() => setStatusFilter("all")}
                >
                  {t("filters.all")}
                </FilterChip>
                {STATUS_FILTERS.map((key) => (
                  <FilterChip
                    key={key}
                    aria-pressed={statusFilter === key}
                    onClick={() => setStatusFilter(key)}
                  >
                    {t(STATUS[key]!.key)}
                  </FilterChip>
                ))}
              </div>
              {recent.length === 0 ? (
                <p className="text-sm text-ink-secondary">{t("your_pledges.filter_empty")}</p>
              ) : (
                <ul className="space-y-3">
                  {recent.map((pl) => {
                    const need = pl.need;
                    const typeLabel = need
                      ? DONATION_TYPES[need.donation_type as keyof typeof DONATION_TYPES]
                          ?.label ?? need.donation_type
                      : "";
                    const when = formatDistanceToNow(new Date(pl.created_at), {
                      addSuffix: true,
                    });
                    const status = STATUS[pl.status] ?? STATUS.pledged!;
                    return (
                      <li
                        key={pl.id}
                        className="rounded-card border border-border-subtle bg-surface-raised p-4 shadow-raised"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-semibold text-ink">{need?.title ?? "—"}</p>
                            <p className="text-sm text-ink-secondary">
                              {need?.institution?.name ?? "—"}
                            </p>
                            <p className="mt-1 text-xs text-ink-tertiary">{typeLabel}</p>
                            {pl.shipment ? (
                              <p className="mt-1 text-xs text-info">
                                {t("dashboard_individual.shipment_prefix")} {pl.shipment.status}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
                            <Badge tone={status.tone}>{t(status.key)}</Badge>
                            <time dateTime={pl.created_at} className="text-xs text-ink-tertiary">
                              {when}
                            </time>
                          </div>
                        </div>
                        {pl.status === "pledged" ? (
                          <div className="mt-3 flex justify-end border-t border-border-subtle pt-3">
                            <CancelActionButton
                              endpoint={`/api/pledges/${pl.id}`}
                              label={t("your_pledges.cancel")}
                              title={t("your_pledges.cancel_title")}
                              description={t("your_pledges.cancel_body", {
                                title: need?.title ?? "",
                              })}
                              confirmLabel={t("your_pledges.cancel_confirm")}
                              successTitle={t("your_pledges.cancel_success")}
                              errorTitle={t("your_pledges.cancel_error")}
                              conflictDescription={t("your_pledges.cancel_error_locked")}
                              onCancelled={() =>
                                setPledges((prev) =>
                                  prev.map((row) =>
                                    row.id === pl.id
                                      ? { ...row, status: "cancelled" as const }
                                      : row
                                  )
                                )
                              }
                            />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>

        <section>
          <SectionHeader title={t("dashboard_individual.volunteer_signups")} />
          {signupsLoading ? (
            <ul className="space-y-3" aria-busy="true">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-24 rounded-card" />
              ))}
            </ul>
          ) : signupsError ? (
            <div role="alert">
              <EmptyState
                title={t("errors.generic_title")}
                description={signupsError}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSignupsLoading(true);
                      setReload((n) => n + 1);
                    }}
                  >
                    {t("errors.retry")}
                  </Button>
                }
              />
            </div>
          ) : signups.length === 0 ? (
            <EmptyState
              icon={<CalendarHeart className="h-10 w-10" aria-hidden="true" />}
              title={t("dashboard_individual.no_volunteer_signups")}
              action={
                <Link href="/volunteer" className={buttonClasses({ variant: "secondary" })}>
                  {t("dashboard_individual.find_volunteer_events")}
                </Link>
              }
            />
          ) : (
            <ul className="space-y-3">
              {signups.map((signup) => {
                const attended = signup.checked_in_at !== null;
                return (
                  <li
                    key={signup.id}
                    className="rounded-card border border-border-subtle bg-surface-raised p-4 shadow-raised"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">
                          {signup.event?.title ?? "—"}
                        </p>
                        {signup.event ? (
                          <p className="text-sm text-ink-secondary">
                            <time dateTime={signup.event.event_date}>
                              {format(parseISO(signup.event.event_date), "PPP", {
                                locale: dateLocale,
                              })}
                            </time>
                            {signup.event.start_time ? ` · ${signup.event.start_time}` : ""}
                          </p>
                        ) : null}
                      </div>
                      {attended ? (
                        <Badge tone="success">
                          {t(
                            signup.checked_out_at
                              ? "volunteer_signup.completed"
                              : "volunteer_signup.checked_in"
                          )}
                        </Badge>
                      ) : null}
                    </div>
                    {attended ? null : (
                      <div className="mt-3 flex justify-end border-t border-border-subtle pt-3">
                        <CancelActionButton
                          endpoint={`/api/volunteer-signups/${signup.id}`}
                          label={t("volunteer_signup.cancel")}
                          title={t("volunteer_signup.cancel_title")}
                          description={t("volunteer_signup.cancel_body", {
                            title: signup.event?.title ?? "",
                          })}
                          confirmLabel={t("volunteer_signup.cancel_confirm")}
                          successTitle={t("volunteer_signup.cancel_success")}
                          errorTitle={t("volunteer_signup.cancel_error")}
                          conflictDescription={t("volunteer_signup.cancel_error_checked_in")}
                          onCancelled={() =>
                            setSignups((prev) =>
                              prev.filter((row) => row.id !== signup.id)
                            )
                          }
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}
