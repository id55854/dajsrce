"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { enUS, hr } from "date-fns/locale";
import { CalendarHeart, Heart, MapPin } from "lucide-react";
import type { AuthProfile } from "@/lib/auth/profile";
import type { Pledge, Shipment } from "@/lib/types";
import { DONATION_TYPES } from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";
import { createClient } from "@/lib/supabase/client";
import { CancelActionButton } from "@/components/YourPledgesSection";
import { ProfileCalendar } from "@/components/ProfileCalendar";
import { individualCalendarEntries } from "@/lib/profile-calendar";
import { SignOutButton } from "@/components/SignOutButton";
import type { AppRole } from "@/lib/auth/roles";
import {
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

type PledgeRow = Pledge & {
  need?: {
    id: string;
    title: string;
    donation_type: string;
    deadline?: string | null;
    is_fulfilled?: boolean;
    description?: string | null;
    quantity_needed?: number | null;
    quantity_pledged?: number | null;
    institution?: { id: string; name: string; category: string };
  };
  shipment?: Shipment | null;
};

/**
 * The volunteer's own signups. Read directly under RLS ("Users can view own
 * active signups") with an explicit column list and a hard cap, because this
 * surface needs the signup id; the id the cancel endpoint is keyed by; and
 * the event it belongs to, which the shared list endpoint does not project.
 */
type SignupEvent = {
  id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time?: string | null;
  description?: string | null;
  requirements?: string | null;
  volunteers_needed?: number | null;
  volunteers_signed_up?: number | null;
  institution?: { name?: string | null } | { name?: string | null }[] | null;
};

type SignupRow = {
  id: string;
  event_id: string;
  created_at: string;
  event: SignupEvent | null;
};

const SIGNUP_LIMIT = 100;

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

function roleTranslationKey(role: AppRole): string {
  if (role === "ngo") return "dashboard_individual.role_ngo";
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
            "id, event_id, created_at, event:volunteer_events(id, title, description, event_date, start_time, end_time, requirements, volunteers_needed, volunteers_signed_up, institution:institutions(name))"
          )
          .eq("user_id", profile.id)
          .is("cancelled_at", null)
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

  // A withdrawn pledge is not a donation: it leaves the history and does not
  // count. Nothing else about a pledge is a state the donor has to track.
  const current = pledges.filter((item) => item.status !== "cancelled");
  const recent = current;
  const active = current.length;

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

        <ProfileCalendar
          entries={individualCalendarEntries(current, signups)}
          loading={loading || signupsLoading}
          error={Boolean(loadError || signupsError)}
          truncated={signups.length >= SIGNUP_LIMIT}
          onRetry={() => { setLoading(true); setSignupsLoading(true); setReload((value) => value + 1); }}
        />

        {/* The volunteer-hours tile went with the check-in flow that was the
            only thing that could ever have filled it. It had always shown an
            em-dash; now nothing records hours at all, so a tile promising
            them would be a promise the product no longer makes. */}
        <section className="grid gap-4 sm:grid-cols-2">
          <Stat
            icon={<Heart className="h-4 w-4" aria-hidden="true" />}
            label={t("dashboard_individual.stat_donations")}
            value={loading ? <Skeleton className="h-8 w-12" /> : active}
          />
          <Stat
            icon={<CalendarHeart className="h-4 w-4" aria-hidden="true" />}
            label={t("dashboard_individual.stat_volunteer_signups")}
            value={signupsLoading ? <Skeleton className="h-8 w-12" /> : signups.length}
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
                <Link href="/doniraj" className={buttonClasses({ variant: "secondary" })}>
                  {t("dashboard_individual.find_places")}
                </Link>
              }
            />
          ) : (
            <>
              {recent.length === 0 ? (
                <p className="text-sm text-ink-secondary">{t("your_pledges.empty")}</p>
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
                    return (
                      <li
                        id={`pledge-${pl.id}`}
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
                          </div>
                          <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
                            <time dateTime={pl.created_at} className="text-xs text-ink-tertiary">
                              {when}
                            </time>
                          </div>
                        </div>
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
                              setPledges((prev) => prev.filter((row) => row.id !== pl.id))
                            }
                          />
                        </div>
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
                return (
                  <li
                    id={`signup-${signup.id}`}
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
                    </div>
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
                        conflictDescription={t("volunteer_signup.cancel_error_locked")}
                        onCancelled={() =>
                          setSignups((prev) => prev.filter((row) => row.id !== signup.id))
                        }
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="border-t border-border-subtle pt-6">
          <SignOutButton />
        </div>
      </div>
    </PageShell>
  );
}
