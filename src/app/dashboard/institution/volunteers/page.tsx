"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { ArrowLeft, Loader2, UserCheck, UserMinus } from "lucide-react";
import { useT } from "@/i18n/client";

type SignupRow = {
  id: string;
  user_id: string;
  event_id: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  company_id: string | null;
  volunteer: { id: string; name: string; email: string };
  event: { id: string; title: string; event_date: string; start_time: string; end_time: string } | null;
};

export default function InstitutionVolunteersPage() {
  const t = useT();
  const [signups, setSignups] = useState<SignupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [qrByEvent, setQrByEvent] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/institution/volunteer-signups", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      const list = (data.signups ?? []) as SignupRow[];
      setSignups(list);

      const eventIds = Array.from(new Set(list.map((s) => s.event_id)));
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const entries: Record<string, string> = {};
      for (const eid of eventIds) {
        const url = `${origin}/volunteer/self-checkin?event=${eid}`;
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

  async function checkIn(signupId: string) {
    setBusy(signupId);
    try {
      const res = await fetch(`/api/volunteer-signups/${signupId}/check-in`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(typeof j.error === "string" ? j.error : "Check-in failed");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function checkOut(signupId: string) {
    setBusy(signupId);
    try {
      const res = await fetch(`/api/volunteer-signups/${signupId}/check-out`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(typeof j.error === "string" ? j.error : "Check-out failed");
        return;
      }
      await load();
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50/60 to-white px-4 py-10 dark:from-gray-950 dark:to-gray-950">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/institution"
            className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("institution.volunteers_back")}
          </Link>
        </div>
        <header>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("institution.volunteers_title")}</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("institution.volunteers_subtitle")}</p>
        </header>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("institution.volunteers_loading")}
          </p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : signups.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">{t("institution.volunteers_empty")}</p>
        ) : (
          Array.from(byEvent.entries()).map(([eventId, rows]) => {
            const ev = rows[0]?.event;
            return (
              <section
                key={eventId}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {ev?.title ?? "Event"}
                    </h2>
                    <p className="text-xs text-gray-500">
                      {ev?.event_date} · {ev?.start_time}–{ev?.end_time}
                    </p>
                  </div>
                  {qrByEvent[eventId] ? (
                    <div className="text-center">
                      <img src={qrByEvent[eventId]} alt="" className="mx-auto rounded-lg border border-gray-200" />
                      <p className="mt-1 text-[10px] text-gray-500">{t("institution.volunteers_qr_caption")}</p>
                    </div>
                  ) : null}
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {rows.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-gray-100">{s.volunteer.name}</p>
                        <p className="text-xs text-gray-500">{s.volunteer.email}</p>
                        <p className="text-xs text-gray-500">
                          {t("institution.volunteers_in")}:{" "}
                          {s.checked_in_at ? new Date(s.checked_in_at).toLocaleString() : "—"} ·{" "}
                          {t("institution.volunteers_out")}:{" "}
                          {s.checked_out_at ? new Date(s.checked_out_at).toLocaleString() : "—"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={Boolean(s.checked_in_at) || Boolean(s.checked_out_at) || busy === s.id}
                          onClick={() => void checkIn(s.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                        >
                          <UserCheck className="h-3.5 w-3.5" aria-hidden />
                          {t("institution.volunteers_check_in")}
                        </button>
                        <button
                          type="button"
                          disabled={!s.checked_in_at || Boolean(s.checked_out_at) || busy === s.id}
                          onClick={() => void checkOut(s.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                        >
                          <UserMinus className="h-3.5 w-3.5" aria-hidden />
                          {t("institution.volunteers_check_out")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
