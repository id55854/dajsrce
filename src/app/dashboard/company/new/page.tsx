"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Building2, Check, Loader2 } from "lucide-react";
import clsx from "clsx";
import { useT } from "@/i18n/client";
import { SIZE_CLASSES } from "@/lib/constants";
import type { SizeClass } from "@/lib/types";

type Step = 0 | 1 | 2 | 3;

type OibLookup = {
  valid: boolean;
  reason?: string;
  registry: {
    legalName: string;
    address: string | null;
    city: string | null;
    isActive: boolean;
  } | null;
};

export default function NewCompanyPage() {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);

  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [oib, setOib] = useState("");
  const [oibState, setOibState] = useState<"idle" | "checking" | "valid" | "invalid" | "registry_hit">(
    "idle"
  );
  const [oibHit, setOibHit] = useState<OibLookup["registry"] | null>(null);

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");

  const [brandPrimary, setBrandPrimary] = useState("#EF4444");
  const [brandSecondary, setBrandSecondary] = useState("#0EA5E9");
  const [sizeClass, setSizeClass] = useState<SizeClass | "">("");
  const [priorRevenue, setPriorRevenue] = useState("");

  const [inviteEmails, setInviteEmails] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);

  async function checkOib() {
    setError(null);
    setErrorHint(null);
    const trimmed = oib.trim();
    if (!/^\d{11}$/.test(trimmed)) {
      setOibState("invalid");
      return;
    }
    setOibState("checking");
    try {
      const res = await fetch(`/api/oib/lookup?oib=${encodeURIComponent(trimmed)}`, {
        credentials: "include",
      });
      const data = (await res.json()) as OibLookup;
      if (!data.valid) {
        setOibState("invalid");
        return;
      }
      if (data.registry) {
        setOibHit(data.registry);
        setOibState("registry_hit");
        if (!legalName) setLegalName(data.registry.legalName);
        if (!address && data.registry.address) setAddress(data.registry.address);
        if (!city && data.registry.city) setCity(data.registry.city);
      } else {
        setOibState("valid");
      }
    } catch {
      setOibState("valid");
    }
  }

  async function submit() {
    setError(null);
    setErrorHint(null);
    setLoading(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legal_name: legalName.trim(),
          display_name: displayName.trim() || undefined,
          oib: oib.trim() || undefined,
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          brand_primary_hex: brandPrimary,
          brand_secondary_hex: brandSecondary,
          size_class: sizeClass || undefined,
          prior_year_revenue_eur: priorRevenue ? Number(priorRevenue) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("common.error_generic"));
        setErrorHint(typeof data.hint === "string" ? data.hint : null);
        return;
      }
      const companyId = data.company.id as string;

      const emails = inviteEmails
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (emails.length > 0) {
        await fetch(`/api/companies/${companyId}/invites`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails }),
        });
      }

      document.cookie = `active_company=${companyId}; path=/; max-age=${60 * 60 * 24 * 180}; SameSite=Lax`;
      router.push(`/dashboard/company?cid=${companyId}`);
      router.refresh();
    } catch {
      setError(t("common.error_generic"));
      setErrorHint(null);
    } finally {
      setLoading(false);
    }
  }

  const canAdvance = (() => {
    if (step === 0) return legalName.trim().length >= 2;
    if (step === 1) return address.trim().length >= 2 && city.trim().length >= 2;
    if (step === 2) return brandPrimary.length >= 4;
    return true;
  })();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          <Building2 className="h-6 w-6 text-red-500" aria-hidden="true" />
          {t("company.onboarding_title")}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("company.onboarding_intro")}
        </p>
      </header>

      <Stepper
        step={step}
        labels={[
          t("company.step_identity"),
          t("company.step_address"),
          t("company.step_brand"),
          t("company.step_invite"),
        ]}
      />

      {error ? (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <p>{error}</p>
          {errorHint ? (
            <p className="mt-2 text-xs leading-relaxed opacity-90 dark:opacity-95">{errorHint}</p>
          ) : null}
        </div>
      ) : null}

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        {step === 0 ? (
          <div className="space-y-4">
            <Field label={t("company.legal_name_label")} required>
              <input
                type="text"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field label={t("company.display_name_label")}>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label={t("company.oib_label")} hint={t("company.oib_hint")}>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{11}"
                  maxLength={11}
                  value={oib}
                  onChange={(e) => {
                    setOib(e.target.value.replace(/\D/g, ""));
                    setOibState("idle");
                  }}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={checkOib}
                  disabled={oib.length !== 11 || oibState === "checking"}
                  className="shrink-0 rounded-xl bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  {oibState === "checking" ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.confirm")}
                </button>
              </div>
              {oibState === "invalid" ? (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{t("company.oib_invalid")}</p>
              ) : null}
              {oibState === "registry_hit" && oibHit ? (
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {oibHit.legalName}
                </p>
              ) : null}
            </Field>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-4">
            <Field label={t("company.address_label")} required>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <Field label={t("company.city_label")} required>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={inputClass}
                required
              />
            </Field>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("company.brand_primary_label")}>
                <input
                  type="color"
                  value={brandPrimary}
                  onChange={(e) => setBrandPrimary(e.target.value)}
                  className="h-10 w-full rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                />
              </Field>
              <Field label={t("company.brand_secondary_label")}>
                <input
                  type="color"
                  value={brandSecondary}
                  onChange={(e) => setBrandSecondary(e.target.value)}
                  className="h-10 w-full rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                />
              </Field>
            </div>
            <Field label={t("company.size_class_label")}>
              <select
                value={sizeClass}
                onChange={(e) => setSizeClass(e.target.value as SizeClass | "")}
                className={inputClass}
              >
                <option value="">—</option>
                {(Object.keys(SIZE_CLASSES) as SizeClass[]).map((k) => (
                  <option key={k} value={k}>
                    {SIZE_CLASSES[k].label} · {SIZE_CLASSES[k].headcount}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("company.prior_year_revenue_label")}
              hint={t("company.prior_year_revenue_hint")}
            >
              <input
                type="number"
                min={0}
                value={priorRevenue}
                onChange={(e) => setPriorRevenue(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <Field
              label={t("company.invite_emails_label")}
              hint={t("company.invite_note")}
            >
              <textarea
                rows={3}
                value={inviteEmails}
                onChange={(e) => setInviteEmails(e.target.value)}
                className={inputClass}
                placeholder="ana@firma.hr, ivan@firma.hr"
              />
            </Field>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s))}
            disabled={step === 0 || loading}
            className="rounded-full px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            {t("common.back")}
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={() => canAdvance && setStep((s) => (s < 3 ? ((s + 1) as Step) : s))}
              disabled={!canAdvance}
              className="rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-red-600 disabled:opacity-50"
            >
              {t("common.continue")}
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-red-600 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t("company.create_cta")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100";

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
      <span className="mb-1 inline-block">
        {label}
        {required ? <span className="ml-1 text-red-500">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs font-normal text-gray-500 dark:text-gray-500">{hint}</span> : null}
    </label>
  );
}

function Stepper({ step, labels }: { step: Step; labels: string[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs font-medium">
      {labels.map((label, idx) => {
        const active = idx === step;
        const done = idx < step;
        return (
          <li
            key={label}
            className={clsx(
              "inline-flex items-center gap-2 rounded-full px-3 py-1",
              active
                ? "bg-red-500 text-white"
                : done
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
            )}
          >
            <span
              className={clsx(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                active
                  ? "bg-white/20"
                  : done
                  ? "bg-emerald-100 dark:bg-emerald-900"
                  : "bg-gray-200 dark:bg-gray-700"
              )}
              aria-hidden="true"
            >
              {done ? <Check className="h-3 w-3" /> : idx + 1}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
