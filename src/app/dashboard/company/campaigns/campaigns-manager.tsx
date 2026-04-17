"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { useT, useLocale } from "@/i18n/client";
import { SDG_GOALS } from "@/lib/constants";
import type { Campaign, CompanyRole } from "@/lib/types";

type Props = {
  companyId: string;
  myRole: CompanyRole;
  campaigns: Campaign[];
};

export function CampaignsManager({ companyId, myRole, campaigns }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const canManage = myRole === "owner" || myRole === "admin";

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [target, setTarget] = useState("");
  const [sdgs, setSdgs] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/campaigns`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          starts_at: startsAt ? new Date(startsAt).toISOString() : null,
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
          target_amount_eur: target ? Number(target) : undefined,
          sdg_tags: sdgs,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("common.error_generic"));
        return;
      }
      setName("");
      setDescription("");
      setStartsAt("");
      setEndsAt("");
      setTarget("");
      setSdgs([]);
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, active: boolean) {
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: active }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("company.campaigns_title")}
        </h2>
        {canManage ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-600"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("company.campaigns_new")}
          </button>
        ) : null}
      </header>

      {open && canManage ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 sm:col-span-2">
              {locale === "hr" ? "Naziv" : "Name"}
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 sm:col-span-2">
              {locale === "hr" ? "Opis" : "Description"}
              <textarea
                rows={3}
                className={inputClass}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {locale === "hr" ? "Početak" : "Starts"}
              <input
                type="date"
                className={inputClass}
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {locale === "hr" ? "Kraj" : "Ends"}
              <input
                type="date"
                className={inputClass}
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {locale === "hr" ? "Cilj (EUR)" : "Target (EUR)"}
              <input
                type="number"
                min={0}
                className={inputClass}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
          </div>

          <fieldset className="mt-4">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              SDG
            </legend>
            <div className="flex flex-wrap gap-2">
              {SDG_GOALS.map((g) => {
                const active = sdgs.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() =>
                      setSdgs((prev) =>
                        prev.includes(g.id) ? prev.filter((n) => n !== g.id) : [...prev, g.id]
                      )
                    }
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      active ? "text-white" : "text-gray-600 dark:text-gray-400"
                    }`}
                    style={
                      active
                        ? { backgroundColor: g.color, borderColor: g.color }
                        : { borderColor: "rgba(0,0,0,0.08)" }
                    }
                    aria-pressed={active}
                  >
                    {g.id}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {error ? (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={create}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-red-600 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("common.save")}
            </button>
          </div>
        </section>
      ) : null}

      {campaigns.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          {t("company.campaigns_empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((c) => (
            <li
              key={c.id}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">{c.name}</h3>
                  <p className="text-xs text-gray-500">
                    {c.starts_at ? new Date(c.starts_at).toLocaleDateString() : "—"}
                    {" → "}
                    {c.ends_at ? new Date(c.ends_at).toLocaleDateString() : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {c.sdg_tags?.slice(0, 5).map((id) => {
                    const g = SDG_GOALS.find((s) => s.id === id);
                    if (!g) return null;
                    return (
                      <span
                        key={id}
                        title={locale === "hr" ? g.labelHr : g.label}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: g.color }}
                      >
                        {id}
                      </span>
                    );
                  })}
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => toggleActive(c.id, !c.is_active)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        c.is_active
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {c.is_active
                        ? locale === "hr"
                          ? "Aktivna"
                          : "Active"
                        : locale === "hr"
                        ? "Pauzirana"
                        : "Paused"}
                    </button>
                  ) : null}
                </div>
              </div>
              {c.description ? (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{c.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100";
