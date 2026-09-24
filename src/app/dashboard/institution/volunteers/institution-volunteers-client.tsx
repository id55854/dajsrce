"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, CalendarHeart, MapPin, Phone } from "lucide-react";
import { NewVolunteerEventForm } from "@/components/NewVolunteerEventForm";
import { Plus } from "lucide-react";
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
  Card,
  Dialog,
  EmptyState,
  PageHeader,
  PageShell,
  Skeleton,
  buttonClasses,
} from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { DeleteActionButton } from "@/components/YourPledgesSection";

type SignupRow = {
  id: string;
  user_id: string;
  event_id: string;
  created_at: string;
  volunteer: { id: string; name: string; email: string };
  event: {
    id: string;
    title: string;
    event_date: string;
    start_time: string;
    end_time: string;
    volunteers_needed?: number | null;
    description?: string | null;
    requirements?: string | null;
    location?: string | null;
    contact_person?: string | null;
    contact_phone?: string | null;
  } | null;
};

type InstitutionVolunteersClientProps = {
  /**
   * True when rendered inside the NGO profile's own tab strip, which already
   * supplies the page shell and the heading. Its own route keeps both so a
   * direct link still works.
   */
  embedded?: boolean;
  refreshKey?: number;
};

/**
 * Who signed up, per event.
 *
 * Signing up is one click and it is final: there is nothing for the
 * organisation to approve, and no attendance ladder to walk the volunteer
 * through. This page used to run check-in and check-out, minting a QR code
 * per event and recording hours; the hours had no reader anywhere in the
 * product, and to the volunteer the flow read as being judged. It is a list
 * of names now.
 */
export function InstitutionVolunteersClient({
  embedded = false,
  refreshKey = 0,
}: InstitutionVolunteersClientProps) {
  const t = useT();
  const { locale } = useLocale();
  const panelId = useId();
  const [publishing, setPublishing] = useState(false);
  const [events, setEvents] = useState<NonNullable<SignupRow["event"]>[]>([]);
  const [signups, setSignups] = useState<SignupRow[]>([]);
  const [activity, setActivity] = useState<Record<string, PersonActivity>>({});
  const [openPerson, setOpenPerson] = useState<RosterPersonDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  /** The event whose details are open; the roster header opens it. */
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setAccessDenied(false);
    try {
      const res = await fetch("/api/institution/volunteer-signups", { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        setAccessDenied(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setSignups((data.signups ?? []) as SignupRow[]);
      setEvents(data.events ?? []);
      setActivity(data.activity ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const byEvent = new Map<string, SignupRow[]>();
  for (const event of events) byEvent.set(event.id, []);
  for (const s of signups) {
    const arr = byEvent.get(s.event_id) ?? [];
    arr.push(s);
    byEvent.set(s.event_id, arr);
  }

  const body = (
    <>
      {loading ? (
        <div className="space-y-4" aria-busy="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-48 rounded-card" />
          ))}
        </div>
      ) : accessDenied ? (
        <Card padding="lg" className="border-warning/30 bg-warning-soft">
          <h2 className="text-base font-semibold text-warning-on-soft">
            {t("institution.volunteers_no_access_title")}
          </h2>
          <p className="mt-2 text-sm text-warning-on-soft/90">
            {t("institution.volunteers_no_access_body")}
          </p>
          <Link
            href="/dashboard"
            className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-4" })}
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {t("institution.volunteers_no_access_back")}
          </Link>
        </Card>
      ) : error ? (
        <EmptyState
          title={t("errors.generic_title")}
          description={error}
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
      ) : byEvent.size === 0 ? (
        <EmptyState title={t("institution.volunteers_empty")} />
      ) : (
        <div className="space-y-4">
          {Array.from(byEvent.entries()).map(([eventId, rows]) => {
            const ev = events.find((event) => event.id === eventId) ?? rows[0]?.event;
            const needed = ev?.volunteers_needed ?? null;
            const date = ev?.event_date
              ? format(parseISO(ev.event_date), "EEE, d. MMM yyyy.", { locale: locale === "hr" ? hr : enUS })
              : null;
            const time = ev ? timeRange(ev.start_time, ev.end_time) : "";
            return (
              <RosterGroup
                key={eventId}
                icon={<CalendarHeart className="h-4 w-4" />}
                tone="info"
                title={ev?.title ?? "—"}
                meta={date ? `${date} · ${time}` : null}
                progress={needed ? (rows.length / needed) * 100 : null}
                onOpen={ev ? () => setOpenEventId(eventId) : undefined}
                openLabel={t("institution.roster_details")}
                count={
                  needed
                    ? t("institution.volunteers_fill", { signed: rows.length, needed })
                    : t("institution.volunteers_count", { count: rows.length })
                }
              >
                {rows.length === 0 ? (
                  <RosterEmpty>{t("institution.event_no_signups")}</RosterEmpty>
                ) : (
                  <RosterList>
                    {rows.map((s) => (
                      <RosterPerson
                        key={s.id}
                        name={s.volunteer.name}
                        onOpen={() =>
                          setOpenPerson({
                            name: s.volunteer.name,
                            email: s.volunteer.email,
                            pledges: activity[s.user_id]?.pledges ?? 0,
                            signups: activity[s.user_id]?.signups ?? 1,
                            since: t("institution.person_signed_up", { when: timeAgo(s.created_at, locale) }),
                          })
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
      <EventDetailsDialog
        event={events.find((event) => event.id === openEventId) ?? null}
        signed={openEventId ? byEvent.get(openEventId)?.length ?? 0 : 0}
        onClose={() => setOpenEventId(null)}
        onDeleted={(id) => {
          setOpenEventId(null);
          setEvents((current) => current.filter((event) => event.id !== id));
          setSignups((current) => current.filter((signup) => signup.event_id !== id));
        }}
      />
    </>
  );

  if (embedded) return body;

  // No back link, for the same reason as the pledges page: this is a navbar
  // tab of its own, so there is nothing behind it to go back to.
  return (
    <PageShell width="wide">
      <PageHeader
        title={t("institution.volunteers_title")}
        subtitle={t("institution.volunteers_subtitle")}
        actions={<Button onClick={() => setPublishing((value) => !value)} aria-expanded={publishing} aria-controls={panelId} icon={<Plus className="h-4 w-4" aria-hidden />}>{t("institution.dashboard_new_event")}</Button>}
      />

      {publishing ? <div className="mb-6"><NewVolunteerEventForm panelId={panelId} onClose={() => setPublishing(false)} onPosted={() => void load()} /></div> : null}
      {body}
    </PageShell>
  );
}

/** "09:00:00" and "12:00:00" read as "09:00–12:00". */
function timeRange(start?: string | null, end?: string | null): string {
  const clip = (value?: string | null) => (value ? value.slice(0, 5) : "");
  return [clip(start), clip(end)].filter(Boolean).join("–");
}

function EventDetailsDialog({ event, signed, onClose, onDeleted }: {
  event: NonNullable<SignupRow["event"]> | null;
  signed: number;
  onClose: () => void;
  onDeleted: (eventId: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  if (!event) return null;
  const date = format(parseISO(event.event_date), "EEEE, d. MMMM yyyy.", { locale: locale === "hr" ? hr : enUS });
  const needed = event.volunteers_needed ?? null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={event.title}
      description={needed ? t("institution.volunteers_fill", { signed, needed }) : t("institution.volunteers_count", { count: signed })}
      closeLabel={t("common.close")}
      variant="sheet-on-mobile"
      footer={
        <DeleteActionButton
          endpoint={`/api/volunteer-events/${event.id}`}
          label={t("institution.event_delete")}
          title={t("institution.event_delete_title")}
          description={
            signed
              ? t("institution.event_delete_body_signups", { count: signed })
              : t("institution.event_delete_body")
          }
          confirmLabel={t("institution.event_delete_confirm")}
          successTitle={t("institution.event_delete_success")}
          errorTitle={t("institution.event_delete_error")}
          conflictDescription={t("common.error_generic")}
          onDeleted={() => onDeleted(event.id)}
        />
      }
    >
      <div className="space-y-5">
        <dl className="space-y-2.5 text-sm">
          <RosterFact icon={<CalendarDays className="h-4 w-4" aria-hidden />} label={t("volunteer_card.when")}>
            {date}
            <span className="block text-ink-secondary">{timeRange(event.start_time, event.end_time)}</span>
          </RosterFact>
          <RosterFact icon={<MapPin className="h-4 w-4" aria-hidden />} label={t("volunteer_card.where")}>
            {event.location?.trim() || t("institution.event_at_our_address")}
          </RosterFact>
          {event.contact_person || event.contact_phone ? (
            <RosterFact icon={<Phone className="h-4 w-4" aria-hidden />} label={t("volunteer_card.contact")}>
              {event.contact_person}
              {event.contact_phone ? <span className="block text-ink-secondary">{event.contact_phone}</span> : null}
            </RosterFact>
          ) : null}
        </dl>
        {event.description ? (
          <RosterSection title={t("volunteer_card.about")}>{event.description}</RosterSection>
        ) : (
          <p className="text-sm text-ink-tertiary">{t("institution.roster_no_description")}</p>
        )}
        {event.requirements ? (
          <RosterSection title={t("volunteer_card.requirements")}>{event.requirements}</RosterSection>
        ) : null}
      </div>
    </Dialog>
  );
}
