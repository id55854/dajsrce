"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { ArrowLeft, UserCheck, UserMinus } from "lucide-react";
import { useT } from "@/i18n/client";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  PageShell,
  Skeleton,
  buttonClasses,
  useToast,
} from "@/components/ui";

type SignupRow = {
  id: string;
  user_id: string;
  event_id: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  volunteer: { id: string; name: string; email: string };
  event: { id: string; title: string; event_date: string; start_time: string; end_time: string } | null;
};

type InstitutionVolunteersClientProps = {
  /**
   * True when rendered inside the NGO profile's own tab strip, which already
   * supplies the page shell, the heading and the way back. Its own route keeps
   * all three so a direct link still works.
   */
  embedded?: boolean;
};

export function InstitutionVolunteersClient({
  embedded = false,
}: InstitutionVolunteersClientProps) {
  const t = useT();
  const toast = useToast();
  const [signups, setSignups] = useState<SignupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [qrByEvent, setQrByEvent] = useState<Record<string, string>>({});

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
      const list = (data.signups ?? []) as SignupRow[];
      setSignups(list);

      const eventIds = Array.from(new Set(list.map((s) => s.event_id)));
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const entries: Record<string, string> = {};
      for (const eid of eventIds) {
        const tokenResponse = await fetch(`/api/volunteer-events/${eid}/check-in-token`, {
          method: "POST",
          credentials: "include",
        });
        if (!tokenResponse.ok) continue;
        const tokenData = (await tokenResponse.json()) as { token?: string };
        if (!tokenData.token) continue;
        const url = `${origin}/volunteer/self-checkin?event=${encodeURIComponent(eid)}&token=${encodeURIComponent(tokenData.token)}`;
        entries[eid] = await QRCode.toDataURL(url, { width: 160, margin: 1 });
      }
      setQrByEvent(entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function patchRow(id: string, patch: Partial<SignupRow>) {
    setSignups((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function reportFailure(detail?: unknown, fallback?: string) {
    toast({
      tone: "error",
      title: t("errors.generic_title"),
      description:
        typeof detail === "string" ? detail : fallback ?? t("common.error_generic"),
    });
  }

  /**
   * Optimistic in place. The previous version awaited a full `load()`, which
   * also re-minted a check-in token and re-rendered every event's QR code on
   * every single check-in — and reported failures through `alert()`.
   */
  async function checkIn(signupId: string) {
    const previous = signups.find((s) => s.id === signupId);
    if (!previous) return;
    setBusy(signupId);
    patchRow(signupId, { checked_in_at: new Date().toISOString() });
    try {
      const res = await fetch(`/api/volunteer-signups/${signupId}/check-in`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        patchRow(signupId, { checked_in_at: previous.checked_in_at });
        reportFailure(data.error);
        return;
      }
      patchRow(signupId, {
        checked_in_at:
          typeof data.checked_in_at === "string"
            ? data.checked_in_at
            : new Date().toISOString(),
      });
      toast({
        tone: "success",
        title: t("institution.volunteers_check_in"),
        description: previous.volunteer.name,
      });
    } catch {
      patchRow(signupId, { checked_in_at: previous.checked_in_at });
      reportFailure();
    } finally {
      setBusy(null);
    }
  }

  async function checkOut(signupId: string) {
    const previous = signups.find((s) => s.id === signupId);
    if (!previous) return;
    setBusy(signupId);
    patchRow(signupId, { checked_out_at: new Date().toISOString() });
    try {
      const res = await fetch(`/api/volunteer-signups/${signupId}/check-out`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        patchRow(signupId, { checked_out_at: previous.checked_out_at });
        reportFailure(data.error);
        return;
      }
      patchRow(signupId, {
        checked_out_at:
          typeof data.checked_out_at === "string"
            ? data.checked_out_at
            : new Date().toISOString(),
      });
      toast({
        tone: "success",
        title: t("institution.volunteers_check_out"),
        description:
          typeof data.hours === "number"
            ? `${previous.volunteer.name} · ${data.hours} h`
            : previous.volunteer.name,
      });
    } catch {
      patchRow(signupId, { checked_out_at: previous.checked_out_at });
      reportFailure();
    } finally {
      setBusy(null);
    }
  }

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
                  {qrByEvent[eventId] ? (
                    <div className="text-center">
                      {/* Generated QR data URLs are already final-size assets. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={qrByEvent[eventId]}
                        alt=""
                        className="mx-auto rounded-control border border-border-subtle"
                      />
                      <p className="mt-1 text-xs text-ink-tertiary">
                        {t("institution.volunteers_qr_caption")}
                      </p>
                    </div>
                  ) : null}
                </div>

                <ul className="divide-y divide-border-subtle">
                  {rows.map((s) => {
                    const pending = busy === s.id;
                    return (
                      <li
                        key={s.id}
                        aria-busy={pending || undefined}
                        className={`flex flex-col gap-3 p-5 transition-opacity sm:flex-row sm:items-center sm:justify-between ${
                          pending ? "opacity-60" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-ink">{s.volunteer.name}</p>
                          <p className="truncate text-sm text-ink-secondary">
                            {s.volunteer.email}
                          </p>
                          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                            <div>
                              <dt className="inline font-medium uppercase tracking-wide text-ink-tertiary">
                                {t("institution.volunteers_in")}:{" "}
                              </dt>
                              <dd className="inline tabular-nums text-ink">
                                {s.checked_in_at
                                  ? new Date(s.checked_in_at).toLocaleString()
                                  : "—"}
                              </dd>
                            </div>
                            <div>
                              <dt className="inline font-medium uppercase tracking-wide text-ink-tertiary">
                                {t("institution.volunteers_out")}:{" "}
                              </dt>
                              <dd className="inline tabular-nums text-ink">
                                {s.checked_out_at
                                  ? new Date(s.checked_out_at).toLocaleString()
                                  : "—"}
                              </dd>
                            </div>
                          </dl>
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {s.checked_out_at ? (
                            <Badge tone="success">{t("institution.volunteers_out")}</Badge>
                          ) : null}
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={
                              Boolean(s.checked_in_at) || Boolean(s.checked_out_at) || pending
                            }
                            onClick={() => void checkIn(s.id)}
                            icon={<UserCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                          >
                            {t("institution.volunteers_check_in")}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!s.checked_in_at || Boolean(s.checked_out_at) || pending}
                            onClick={() => void checkOut(s.id)}
                            icon={<UserMinus className="h-3.5 w-3.5" aria-hidden="true" />}
                          >
                            {t("institution.volunteers_check_out")}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );

  if (embedded) return body;

  return (
    <PageShell width="wide">
      <Link
        href="/dashboard/institution"
        className="mb-6 inline-flex items-center gap-2 rounded text-sm font-semibold text-brand transition-colors hover:text-brand-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("institution.volunteers_back")}
      </Link>

      <PageHeader
        title={t("institution.volunteers_title")}
        subtitle={t("institution.volunteers_subtitle")}
      />

      {body}
    </PageShell>
  );
}
