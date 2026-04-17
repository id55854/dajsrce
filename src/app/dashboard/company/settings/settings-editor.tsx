"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { useT, useLocale } from "@/i18n/client";
import { SIZE_CLASSES, SUBSCRIPTION_TIERS } from "@/lib/constants";
import type { Company, CompanyRole, SizeClass } from "@/lib/types";
import { ceilingPct, headroomEur } from "@/lib/tax";
import { useRouter } from "next/navigation";

type Props = {
  company: Company;
  myRole: CompanyRole;
};

export function SettingsEditor({ company, myRole }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const canManage = myRole === "owner" || myRole === "admin";

  const [displayName, setDisplayName] = useState(company.display_name ?? "");
  const [tagline, setTagline] = useState(company.tagline ?? "");
  const [address, setAddress] = useState(company.address ?? "");
  const [city, setCity] = useState(company.city ?? "");
  const [brandPrimary, setBrandPrimary] = useState(company.brand_primary_hex ?? "#EF4444");
  const [brandSecondary, setBrandSecondary] = useState(company.brand_secondary_hex ?? "#0EA5E9");
  const [logoUrl, setLogoUrl] = useState(company.logo_url ?? "");
  const [sizeClass, setSizeClass] = useState<SizeClass | "">(company.size_class ?? "");
  const [matchRatio, setMatchRatio] = useState(String(company.default_match_ratio ?? 0));
  const [priorRevenue, setPriorRevenue] = useState(
    company.prior_year_revenue_eur !== null ? String(company.prior_year_revenue_eur) : ""
  );

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/companies/${company.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim() || null,
          tagline: tagline.trim() || null,
          address: address.trim() || null,
          city: city.trim() || null,
          brand_primary_hex: brandPrimary,
          brand_secondary_hex: brandSecondary,
          logo_url: logoUrl.trim() || null,
          size_class: sizeClass || null,
          default_match_ratio: Number(matchRatio || 0),
          prior_year_revenue_eur: priorRevenue ? Number(priorRevenue) : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(data.error ?? t("common.error_generic"));
        return;
      }
      setMessage(locale === "hr" ? "Spremljeno." : "Saved.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const tier = SUBSCRIPTION_TIERS[company.subscription_tier];
  const headroom = headroomEur(priorRevenue ? Number(priorRevenue) : null);

  return (
    <div className="space-y-8">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("company.settings_title")}
      </h2>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("company.settings_brand_section")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={locale === "hr" ? "Prikazni naziv" : "Display name"}>
            <input
              className={inputClass}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={!canManage}
            />
          </Field>
          <Field label={locale === "hr" ? "Slogan" : "Tagline"}>
            <input
              className={inputClass}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              disabled={!canManage}
            />
          </Field>
          <Field label={t("company.address_label")}>
            <input
              className={inputClass}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!canManage}
            />
          </Field>
          <Field label={t("company.city_label")}>
            <input
              className={inputClass}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={!canManage}
            />
          </Field>
          <Field label={t("company.brand_primary_label")}>
            <input
              type="color"
              className="h-10 w-full rounded-xl border border-gray-200 dark:border-gray-700"
              value={brandPrimary}
              onChange={(e) => setBrandPrimary(e.target.value)}
              disabled={!canManage}
            />
          </Field>
          <Field label={t("company.brand_secondary_label")}>
            <input
              type="color"
              className="h-10 w-full rounded-xl border border-gray-200 dark:border-gray-700"
              value={brandSecondary}
              onChange={(e) => setBrandSecondary(e.target.value)}
              disabled={!canManage}
            />
          </Field>
          <Field label={t("company.logo_label")} hint={t("company.logo_hint")}>
            <input
              className={inputClass}
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…"
              disabled={!canManage}
            />
          </Field>
          <Field label={t("company.size_class_label")}>
            <select
              className={inputClass}
              value={sizeClass}
              onChange={(e) => setSizeClass(e.target.value as SizeClass | "")}
              disabled={!canManage}
            >
              <option value="">—</option>
              {(Object.keys(SIZE_CLASSES) as SizeClass[]).map((k) => (
                <option key={k} value={k}>
                  {SIZE_CLASSES[k].label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("company.settings_finance_section")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("company.prior_year_revenue_label")}
            hint={t("company.prior_year_revenue_hint")}
          >
            <input
              type="number"
              min={0}
              className={inputClass}
              value={priorRevenue}
              onChange={(e) => setPriorRevenue(e.target.value)}
              disabled={!canManage}
            />
          </Field>
          <Field
            label={t("company.settings_match_ratio_label")}
            hint={t("company.settings_match_ratio_hint")}
          >
            <input
              type="number"
              step="0.05"
              min={0}
              max={10}
              className={inputClass}
              value={matchRatio}
              onChange={(e) => setMatchRatio(e.target.value)}
              disabled={!canManage}
            />
          </Field>
        </div>
        <p className="mt-4 rounded-xl bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-400">
          {t("tax.ceiling_hint", { pct: ceilingPct().toFixed(1) })}
          {" · "}
          {locale === "hr" ? "Gornji limit" : "Ceiling"}: {formatEur(headroom)}
        </p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("company.settings_billing_section")}
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {locale === "hr" ? tier.labelHr : tier.label}
            </p>
            <p className="text-xs text-gray-500">
              {company.subscription_status} · {tier.teamSeats === "unlimited"
                ? locale === "hr"
                  ? "Neograničen tim"
                  : "Unlimited seats"
                : `${tier.teamSeats} ${locale === "hr" ? "mjesta" : "seats"}`}
            </p>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {locale === "hr" ? "Upravljanje u Fazi 1" : "Manage in Phase 1"}
          </span>
        </div>
      </section>

      {canManage ? (
        <div className="flex items-center justify-end gap-3">
          {message ? (
            <span className="text-sm text-gray-600 dark:text-gray-400">{message}</span>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-red-600 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("common.save")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {label}
      {children}
      {hint ? <span className="mt-1 block text-xs font-normal text-gray-500">{hint}</span> : null}
    </label>
  );
}

function formatEur(value: number): string {
  if (!value || value <= 0) return "—";
  return new Intl.NumberFormat("hr-HR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

const inputClass =
  "mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100";
