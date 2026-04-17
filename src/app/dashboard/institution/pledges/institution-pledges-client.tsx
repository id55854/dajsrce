"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Package } from "lucide-react";
import { useT } from "@/i18n/client";

type Ack = { id: string; kind: string; signed_at: string; notes: string | null };
type PledgeRow = {
  id: string;
  quantity: number;
  status: string;
  amount_eur: number | null;
  delivered_at: string | null;
  tax_category: string;
  created_at: string;
  need: { title: string } | null;
  pledge_acknowledgements: Ack[] | null;
};

export function InstitutionPledgesClient() {
  const t = useT();
  const [pledges, setPledges] = useState<PledgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/institution/pledges", { credentials: "include" });
      const data = await res.json();
      if (res.ok) setPledges(data.pledges ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markDelivered(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/pledges/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "delivered" }),
      });
      if (res.ok) await load();
    } finally {
      setBusy(null);
    }
  }

  async function submitAck(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/pledges/${id}/acknowledge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: noteText.trim() || undefined }),
      });
      if (res.ok) {
        setNotesFor(null);
        setNoteText("");
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link
        href="/dashboard/institution"
        className="inline-flex items-center gap-2 text-sm font-medium text-red-600 hover:underline dark:text-red-400"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("common.back")}
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("institution.pledges_title")}</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t("institution.pledges_subtitle")}</p>
      </header>

      {loading ? (
        <p className="text-sm text-gray-500">{t("institution.loading")}</p>
      ) : pledges.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
          {t("institution.pledges_empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {pledges.map((p) => {
            const acks = p.pledge_acknowledgements;
            const ack = Array.isArray(acks) && acks.length > 0 ? acks[0] : null;
            return (
              <li
                key={p.id}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">
                      {p.need?.title ?? t("institution.pledges_need")}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t("institution.pledges_status")}: {p.status} · qty {p.quantity}
                      {p.amount_eur != null ? ` · €${Number(p.amount_eur).toFixed(2)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {p.status === "pledged" ? (
                      <button
                        type="button"
                        disabled={busy === p.id}
                        onClick={() => void markDelivered(p.id)}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                      >
                        {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Package className="h-3 w-3" />}
                        {t("institution.mark_delivered")}
                      </button>
                    ) : null}
                    {p.status === "delivered" && !ack ? (
                      <>
                        {notesFor === p.id ? (
                          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[220px]">
                            <input
                              className="rounded-lg border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
                              placeholder={t("institution.notes_placeholder")}
                              value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={busy === p.id}
                                onClick={() => void submitAck(p.id)}
                                className="rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-white hover:bg-red-600"
                              >
                                {t("common.confirm")}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setNotesFor(null);
                                  setNoteText("");
                                }}
                                className="text-xs text-gray-600"
                              >
                                {t("common.cancel")}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={busy === p.id}
                            onClick={() => setNotesFor(p.id)}
                            className="inline-flex items-center gap-1 rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                          >
                            <Check className="h-3 w-3" />
                            {t("institution.acknowledge")}
                          </button>
                        )}
                      </>
                    ) : null}
                    {ack ? (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        {t("institution.acknowledged")} ({ack.kind})
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
