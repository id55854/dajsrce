"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { enUS, hr } from "date-fns/locale";
import { CalendarHeart, Heart, Mail, MapPin } from "lucide-react";
import type { AuthProfile } from "@/lib/auth/profile";
import type { Pledge, Shipment } from "@/lib/types";
import { DONATION_TYPES } from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";
import { createClient } from "@/lib/supabase/client";
import { CancelActionButton } from "@/components/YourPledgesSection";
import { ProfileCalendar } from "@/components/ProfileCalendar";
import { individualCalendarEntries } from "@/lib/profile-calendar";
import { SignOutButton } from "@/components/SignOutButton";
import { ProfileChip, ProfileHeader } from "@/components/ProfileHeader";
import { RosterGroup, RosterItem, RosterList, RosterQuantity } from "@/components/Roster";
import { timeAgo } from "@/lib/utils";
import type { AppRole } from "@/lib/auth/roles";
import {
  Button,
  EmptyState,
  PageShell,
  Skeleton,
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
  institution?: SignupInstitution | SignupInstitution[] | null;
};

type SignupInstitution = { name?: string | null; address?: string | null; city?: string | null };

/** PostgREST may answer the to-one embed as an object or a one-element list. */
function embeddedInstitution(value: SignupEvent["institution"] | undefined): SignupInstitution | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

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
            "id, event_id, created_at, event:volunteer_events(id, title, description, event_date, start_time, end_time, requirements, volunteers_needed, volunteers_signed_up, institution:institutions(name, address:public_address, city))"
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

  return (
    <PageShell width="wide">
      <div className="space-y-6">
        <ProfileHeader
          title={profile.name || profile.email}
          facts={
            <>
              <ProfileChip>{t(roleTranslationKey(profile.role))}</ProfileChip>
              {profile.email ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Mail className="h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
                  <span className="truncate">{profile.email}</span>
                </span>
              ) : null}
            </>
          }
          links={
            <Link href="/" className={buttonClasses({ variant: "ghost", size: "sm" })}>
              <MapPin className="h-4 w-4" aria-hidden />
              {t("dashboard_individual.find_places")}
            </Link>
          }
          actions={
            <>
              <Link href="/doniraj" className={buttonClasses()}>
                <Heart className="h-4 w-4" aria-hidden />
                {t("nav.donate")}
              </Link>
              <Link href="/volunteer" className={buttonClasses({ variant: "secondary" })}>
                <CalendarHeart className="h-4 w-4" aria-hidden />
                {t("nav.volunteer")}
              </Link>
            </>
          }
        />

        <ProfileCalendar
          entries={individualCalendarEntries(current, signups)}
          loading={loading || signupsLoading}
          error={Boolean(loadError || signupsError)}
          truncated={signups.length >= SIGNUP_LIMIT}
          onRetry={() => { setLoading(true); setSignupsLoading(true); setReload((value) => value + 1); }}
        />

        <section>
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
                <RosterGroup
                  title={t("dashboard_individual.donation_history")}
                  count={t("institution.pledges_count", { count: recent.length })}
                >
                  <RosterList>
                    {recent.map((pl) => {
                      const need = pl.need;
                      const type = need ? DONATION_TYPES[need.donation_type as keyof typeof DONATION_TYPES] : null;
                      const typeLabel = type ? (locale === "hr" ? type.labelHr : type.label) : need?.donation_type ?? "";
                      return (
                        <RosterItem
                          id={`pledge-${pl.id}`}
                          key={pl.id}
                          title={need?.title ?? "—"}
                          subtitle={[need?.institution?.name, typeLabel].filter(Boolean).join(" · ")}
                          detail={<time dateTime={pl.created_at}>{timeAgo(pl.created_at, locale)}</time>}
                          aside={
                            <RosterQuantity
                              value={pl.quantity}
                              label={pl.amount_eur != null ? `€${Number(pl.amount_eur).toFixed(2)}` : t("institution.roster_quantity")}
                            />
                          }
                          action={
                            <CancelActionButton
                              endpoint={`/api/pledges/${pl.id}`}
                              label={t("your_pledges.cancel")}
                              title={t("your_pledges.cancel_title")}
                              description={t("your_pledges.cancel_body", { title: need?.title ?? "" })}
                              confirmLabel={t("your_pledges.cancel_confirm")}
                              successTitle={t("your_pledges.cancel_success")}
                              errorTitle={t("your_pledges.cancel_error")}
                              conflictDescription={t("your_pledges.cancel_error_locked")}
                              onCancelled={() => setPledges((prev) => prev.filter((row) => row.id !== pl.id))}
                            />
                          }
                        />
                      );
                    })}
                  </RosterList>
                </RosterGroup>
              )}
            </>
          )}
        </section>

        <section>
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
            <RosterGroup
              title={t("dashboard_individual.volunteer_signups")}
              count={t("institution.volunteers_count", { count: signups.length })}
            >
              <RosterList>
                {signups.map((signup) => {
                  const event = signup.event;
                  const organisation = embeddedInstitution(event?.institution);
                  return (
                    <RosterItem
                      id={`signup-${signup.id}`}
                      key={signup.id}
                      title={event?.title ?? "—"}
                      subtitle={[organisation?.name, organisation?.city].filter(Boolean).join(" · ")}
                      detail={
                        event ? (
                          <>
                            <time dateTime={event.event_date}>
                              {format(parseISO(event.event_date), "EEE, d. MMM yyyy.", { locale: dateLocale })}
                            </time>
                            {event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ""}
                            {event.end_time ? `–${event.end_time.slice(0, 5)}` : ""}
                          </>
                        ) : null
                      }
                      action={
                        <CancelActionButton
                          endpoint={`/api/volunteer-signups/${signup.id}`}
                          label={t("volunteer_signup.cancel")}
                          title={t("volunteer_signup.cancel_title")}
                          description={t("volunteer_signup.cancel_body", { title: event?.title ?? "" })}
                          confirmLabel={t("volunteer_signup.cancel_confirm")}
                          successTitle={t("volunteer_signup.cancel_success")}
                          errorTitle={t("volunteer_signup.cancel_error")}
                          conflictDescription={t("volunteer_signup.cancel_error_locked")}
                          onCancelled={() => setSignups((prev) => prev.filter((row) => row.id !== signup.id))}
                        />
                      }
                    />
                  );
                })}
              </RosterList>
            </RosterGroup>
          )}
        </section>

        <div className="border-t border-border-subtle pt-6">
          <SignOutButton />
        </div>
      </div>
    </PageShell>
  );
}
