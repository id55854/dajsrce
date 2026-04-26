"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useT } from "@/i18n/client";

type SudregSnapshot = {
  oib: string;
  legalName: string;
  shortName: string | null;
  legalForm: string | null;
  street: string | null;
  city: string | null;
  county: string | null;
  emails: string[];
  mb: string | null;
  mbs: string | null;
  status: number | null;
  foundingDate: string | null;
  fetchedAt: string;
};

type Verification = {
  id: string;
  contact_email: string;
  expires_at: string;
  confirmed_at: string | null;
  sudreg_legal_name: string;
  sudreg_short_name: string | null;
  sudreg_address: string | null;
  sudreg_city: string | null;
  sudreg_legal_form: string | null;
  sudreg_status: number | null;
  sudreg_mb: string | null;
  sudreg_mbs: string | null;
  sudreg_oib: string;
  sudreg_fetched_at: string;
  created_at: string;
};

type Status = {
  verification: Verification | null;
  company_verified_at: string | null;
};

export function CompanyVerificationSection({
  companyId,
  companySlug,
  companyDomain,
}: {
  companyId: string;
  companySlug: string | null;
  companyDomain: string | null;
}) {
  const t = useT();

  const [statusLoading, setStatusLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);

  const [oib, setOib] = useState("");
  const [snapshot, setSnapshot] = useState<SudregSnapshot | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [emailChoice, setEmailChoice] = useState<string>("__manual__");
  const [emailManual, setEmailManual] = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/verification`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as Status;
        setStatus(data);
      }
    } finally {
      setStatusLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const verified = !!status?.company_verified_at;
  const pending =
    !verified &&
    !!status?.verification &&
    !status.verification.confirmed_at &&
    new Date(status.verification.expires_at).getTime() > Date.now();

  async function handleLookup() {
    setLookupError(null);
    setSnapshot(null);
    setLookupLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/verification/lookup`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oib: oib.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const map: Record<number, string> = {
          400: t("company.verification.error_invalid_oib"),
          404: t("company.verification.error_not_found"),
          429: t("company.verification.error_rate_limit"),
        };
        setLookupError(map[res.status] ?? data?.error ?? t("company.verification.error_generic"));
        return;
      }
      setSnapshot(data.company as SudregSnapshot);
      setEmailChoice(
        (data.company as SudregSnapshot).emails?.[0] ?? "__manual__"
      );
    } catch {
      setLookupError(t("company.verification.error_generic"));
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleSend() {
    if (!snapshot) return;
    const contact_email =
      emailChoice === "__manual__" ? emailManual.trim() : emailChoice;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact_email)) {
      setSendError(t("company.verification.error_generic"));
      return;
    }
    setSendError(null);
    setSendLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/verification/start`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oib: snapshot.oib, contact_email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSendError(data?.error ?? t("company.verification.error_generic"));
        return;
      }
      setSnapshot(null);
      setOib("");
      await fetchStatus();
    } catch {
      setSendError(t("company.verification.error_generic"));
    } finally {
      setSendLoading(false);
    }
  }

  async function handleCancel() {
    await fetch(`/api/companies/${companyId}/verification`, {
      method: "DELETE",
      credentials: "include",
    });
    await fetchStatus();
  }

  const showDomainWarning = useMemo(() => {
    if (emailChoice === "__manual__") {
      const at = emailManual.lastIndexOf("@");
      const domain = at < 0 ? "" : emailManual.slice(at + 1).toLowerCase();
      return !!domain && !!companyDomain && domain !== companyDomain.toLowerCase();
    }
    return false;
  }, [emailChoice, emailManual, companyDomain]);

  if (statusLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading…
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t("company.verification.section_title")}
        </h2>
        {verified ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
            {t("company.verification.verified_badge")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
            {t("company.verification.unverified_badge")}
          </span>
        )}
      </header>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {t("company.verification.section_intro")}
      </p>

      {verified ? (
        <VerifiedCard
          verifiedAt={status!.company_verified_at!}
          companySlug={companySlug}
          onReverify={async () => {
            // Reverification: just clear local snapshot — verified_at is preserved
            // until the new flow completes. The user can run the full 3 steps again.
            setSnapshot(null);
            setOib("");
            setEmailChoice("__manual__");
            setEmailManual("");
          }}
        />
      ) : null}

      {pending && status?.verification ? (
        <PendingCard
          v={status.verification}
          onCancel={handleCancel}
        />
      ) : null}

      {/* Always show the run-flow form unless there's an active pending state. */}
      {!pending ? (
        <div className="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          {/* Step 1: OIB lookup */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("company.verification.step1_title")}
            </h3>
            <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-gray-500">
              {t("company.verification.step1_oib_label")}
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={11}
                value={oib}
                onChange={(e) => setOib(e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder={t("company.verification.step1_oib_placeholder")}
                className="min-w-[12rem] flex-1 rounded-xl border border-gray-200 px-4 py-2.5 font-mono text-sm tracking-wider text-gray-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={handleLookup}
                disabled={oib.length !== 11 || lookupLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-600 disabled:opacity-50"
              >
                {lookupLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Search className="h-4 w-4" aria-hidden />
                )}
                {lookupLoading
                  ? t("company.verification.step1_lookup_loading")
                  : t("company.verification.step1_lookup_btn")}
              </button>
            </div>
            {lookupError ? (
              <p className="mt-2 inline-flex items-center gap-1 text-sm text-red-600">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                {lookupError}
              </p>
            ) : null}
          </div>

          {/* Steps 2 & 3: visible only after a successful lookup */}
          {snapshot ? (
            <>
              <SnapshotCard snapshot={snapshot} />
              <EmailPicker
                snapshot={snapshot}
                emailChoice={emailChoice}
                emailManual={emailManual}
                onEmailChoice={setEmailChoice}
                onEmailManual={setEmailManual}
                showDomainWarning={showDomainWarning}
              />
              <div className="flex flex-wrap items-center justify-end gap-3">
                {sendError ? (
                  <p className="inline-flex items-center gap-1 text-sm text-red-600">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    {sendError}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sendLoading}
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {sendLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Mail className="h-4 w-4" aria-hidden />
                  )}
                  {sendLoading
                    ? t("company.verification.step3_send_loading")
                    : t("company.verification.step3_send_btn")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function VerifiedCard({
  verifiedAt,
  companySlug,
  onReverify,
}: {
  verifiedAt: string;
  companySlug: string | null;
  onReverify: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/40">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <div className="flex-1">
          <h3 className="text-base font-semibold text-emerald-900 dark:text-emerald-100">
            {t("company.verification.verified_title")}
          </h3>
          <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200/90">
            {t("company.verification.verified_body")}
          </p>
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300/80">
            {t("company.verification.verified_at")}{" "}
            {new Date(verifiedAt).toLocaleString()}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {companySlug ? (
              <a
                href={`/company/${companySlug}`}
                className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                {t("company.verification.go_to_company")}
              </a>
            ) : null}
            <button
              type="button"
              onClick={onReverify}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              {t("company.verification.reverify")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PendingCard({
  v,
  onCancel,
}: {
  v: Verification;
  onCancel: () => void | Promise<void>;
}) {
  const t = useT();
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm dark:border-amber-900 dark:bg-amber-950/40">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="flex-1">
          <h3 className="text-base font-semibold text-amber-900 dark:text-amber-100">
            {t("company.verification.pending_title")}
          </h3>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-200/90">
            {t("company.verification.pending_body")
              .replace("{email}", v.contact_email)
              .replace("{expires}", new Date(v.expires_at).toLocaleString())}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onCancel()}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
            >
              <X className="h-3 w-3" aria-hidden />
              {t("company.verification.pending_cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SnapshotCard({ snapshot }: { snapshot: SudregSnapshot }) {
  const t = useT();
  const active = snapshot.status === 1;
  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("company.verification.step2_title")}
        </h3>
        <span
          className={clsx(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            active
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
              : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
          )}
        >
          {active
            ? t("company.verification.step2_status_active")
            : t("company.verification.step2_status_inactive")}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Field label={t("company.verification.step2_legal_name")} value={snapshot.legalName} />
        {snapshot.shortName ? (
          <Field label={t("company.verification.step2_short_name")} value={snapshot.shortName} />
        ) : null}
        <Field label={t("company.verification.step2_legal_form")} value={snapshot.legalForm} />
        <Field
          label={t("company.verification.step2_address")}
          value={
            [snapshot.street, snapshot.city, snapshot.county]
              .filter(Boolean)
              .join(", ") || null
          }
        />
        <Field label="OIB" value={snapshot.oib} mono />
        <Field label={t("company.verification.step2_mb")} value={snapshot.mb} mono />
        <Field label={t("company.verification.step2_mbs")} value={snapshot.mbs} mono />
      </dl>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd
        className={clsx(
          "text-gray-900 dark:text-gray-100",
          mono && "font-mono"
        )}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

function EmailPicker({
  snapshot,
  emailChoice,
  emailManual,
  onEmailChoice,
  onEmailManual,
  showDomainWarning,
}: {
  snapshot: SudregSnapshot;
  emailChoice: string;
  emailManual: string;
  onEmailChoice: (v: string) => void;
  onEmailManual: (v: string) => void;
  showDomainWarning: boolean;
}) {
  const t = useT();
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {t("company.verification.step3_title")}
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        {t("company.verification.step3_email_choose")}
      </p>
      <div className="mt-3 space-y-2">
        {snapshot.emails.map((e) => (
          <label
            key={e}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm has-[:checked]:border-emerald-400 has-[:checked]:bg-emerald-50 dark:border-gray-700 dark:bg-gray-800 dark:has-[:checked]:bg-emerald-950/40"
          >
            <input
              type="radio"
              name="verify-email"
              value={e}
              checked={emailChoice === e}
              onChange={(ev) => onEmailChoice(ev.target.value)}
              className="h-4 w-4 accent-emerald-600"
            />
            <span className="font-mono text-gray-900 dark:text-gray-100">{e}</span>
          </label>
        ))}
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm has-[:checked]:border-emerald-400 has-[:checked]:bg-emerald-50 dark:border-gray-700 dark:bg-gray-800 dark:has-[:checked]:bg-emerald-950/40">
          <input
            type="radio"
            name="verify-email"
            value="__manual__"
            checked={emailChoice === "__manual__"}
            onChange={(ev) => onEmailChoice(ev.target.value)}
            className="mt-1 h-4 w-4 accent-emerald-600"
          />
          <span className="flex-1">
            <span className="block font-medium text-gray-900 dark:text-gray-100">
              {t("company.verification.step3_email_other")}
            </span>
            <input
              type="email"
              value={emailManual}
              onChange={(e) => onEmailManual(e.target.value)}
              placeholder={t("company.verification.step3_email_placeholder")}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
            {showDomainWarning ? (
              <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {t("company.verification.email_warning_domain")}
              </span>
            ) : null}
          </span>
        </label>
      </div>
    </div>
  );
}
