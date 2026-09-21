"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useT } from "@/i18n/client";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  PageShell,
  Skeleton,
  buttonClasses,
} from "@/components/ui";
import { timeAgo } from "@/lib/utils";

type SignupRow = {
  id: string;
  user_id: string;
  event_id: string;
  created_at: string;
  volunteer: { id: string; name: string; email: string };
  event: { id: string; title: string; event_date: string; start_time: string; end_time: string } | null;
};

type InstitutionVolunteersClientProps = {
  /**
   * True when rendered inside the NGO profile's own tab strip, which already
   * supplies the page shell and the heading. Its own route keeps both so a
   * direct link still works.
   */
  embedded?: boolean;
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
}: InstitutionVolunteersClientProps) {
  const t = useT();
  const [signups, setSignups] = useState<SignupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byEvent = new Map<string, SignupRow[]>();
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
      ) : signups.length === 0 ? (
        <EmptyState title={t("institution.volunteers_empty")} />
      ) : (
        <div className="space-y-6">
          {Array.from(byEvent.entries()).map(([eventId, rows]) => {
            const ev = rows[0]?.event;
            return (
              <Card key={eventId} padding="none">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-subtle p-5">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-ink">{ev?.title ?? "—"}</h2>
                    <p className="mt-1 text-sm text-ink-secondary">
                      {ev?.event_date} · {ev?.start_time}–{ev?.end_time}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm text-ink-secondary">
                    {t("institution.volunteers_count", { count: rows.length })}
                  </p>
                </div>

                <ul className="divide-y divide-border-subtle">
                  {rows.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{s.volunteer.name}</p>
                        <p className="truncate text-sm text-ink-secondary">
                          {s.volunteer.email}
                        </p>
                      </div>
                      <time
                        dateTime={s.created_at}
                        className="shrink-0 text-xs text-ink-tertiary"
                      >
                        {t("institution.volunteers_signed_up", { when: timeAgo(s.created_at) })}
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

  // No back link, for the same reason as the pledges page: this is a navbar
  // tab of its own, so there is nothing behind it to go back to.
  return (
    <PageShell width="wide">
      <PageHeader
        title={t("institution.volunteers_title")}
        subtitle={t("institution.volunteers_subtitle")}
      />

      {body}
    </PageShell>
  );
}
