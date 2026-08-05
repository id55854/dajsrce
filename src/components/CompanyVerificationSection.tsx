"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Mail,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useT } from "@/i18n/client";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  Skeleton,
  buttonClasses,
  useToast,
} from "@/components/ui";

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
  const toast = useToast();

  const [statusLoading, setStatusLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);

  const [oib, setOib] = useState("");
  const [snapshot, setSnapshot] = useState<SudregSnapshot | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  // The component had three different error placements. Errors about a value
  // the user typed now live on that field; every network *outcome* is a toast.
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [emailChoice, setEmailChoice] = useState<string>("__manual__");
  const [emailManual, setEmailManual] = useState("");
  const [sendLoading, setSendLoading] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);

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

  function reportFailure(detail?: unknown) {
    toast({
      tone: "error",
      title: t("errors.generic_title"),
      description:
        typeof detail === "string" ? detail : t("company.verification.error_generic"),
    });
  }

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
      setEmailChoice((data.company as SudregSnapshot).emails?.[0] ?? "__manual__");
    } catch {
      setLookupError(t("company.verification.error_generic"));
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleSend() {
    if (!snapshot) return;
    const contact_email = emailChoice === "__manual__" ? emailManual.trim() : emailChoice;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact_email)) {
      setEmailError(t("company.verification.error_generic"));
      return;
    }
    setEmailError(null);
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
        reportFailure(data?.error);
        return;
      }
      toast({
        tone: "success",
        title: t("company.verification.pending_title"),
        description: contact_email,
      });
      setSnapshot(null);
      setOib("");
      await fetchStatus();
    } catch {
      reportFailure();
    } finally {
      setSendLoading(false);
    }
  }

  async function handleCancel() {
    setCancelLoading(true);
    try {
      // The result of this DELETE used to be discarded entirely, so a failed
      // cancel looked identical to a successful one.
      const res = await fetch(`/api/companies/${companyId}/verification`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        reportFailure(data?.error);
        return;
      }
      setCancelOpen(false);
      toast({ tone: "success", title: t("company.verification_sent") });
      await fetchStatus();
    } catch {
      reportFailure();
    } finally {
      setCancelLoading(false);
    }
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
      <Card padding="lg" className="space-y-3" aria-busy="true">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-11 w-64" />
      </Card>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-ink">
          {t("company.verification.section_title")}
        </h2>
        {verified ? (
          <Badge tone="success" icon={<BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />}>
            {t("company.verification.verified_badge")}
          </Badge>
        ) : (
          <Badge tone="neutral" icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}>
            {t("company.verification.unverified_badge")}
          </Badge>
        )}
      </header>
      <p className="text-base leading-7 text-ink-secondary">
        {t("company.verification.section_intro")}
      </p>

      {verified ? (
        <VerifiedCard
          verifiedAt={status!.company_verified_at!}
          companySlug={companySlug}
          onReverify={() => {
            // Reverification: just clear local snapshot — verified_at is preserved
            // until the new flow completes. The user can run the full 3 steps again.
            setSnapshot(null);
            setOib("");
            setEmailChoice("__manual__");
            setEmailManual("");
            setLookupError(null);
            setEmailError(null);
          }}
        />
      ) : null}

      {pending && status?.verification ? (
        <PendingCard v={status.verification} onCancel={() => setCancelOpen(true)} />
      ) : null}

      {/* Always show the run-flow form unless there's an active pending state. */}
      {!pending ? (
        <Card padding="lg" className="space-y-6">
          {/* Step 1: OIB lookup */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-ink">
              {t("company.verification.step1_title")}
            </h3>
            <div className="flex flex-wrap items-end gap-2">
              <Field
                label={t("company.verification.step1_oib_label")}
                error={lookupError}
                className="min-w-[12rem] flex-1"
              >
                {(field) => (
                  <Input
                    {...field}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={11}
                    value={oib}
                    onChange={(e) => {
                      setOib(e.target.value.replace(/\D/g, "").slice(0, 11));
                      setLookupError(null);
                    }}
                    placeholder={t("company.verification.step1_oib_placeholder")}
                    invalid={!!lookupError}
                    className="font-mono tracking-wider"
                  />
                )}
              </Field>
              {/* Brand red, like every other primary action in the app — this
                  was the one emerald "primary" button on the surface. */}
              <Button
                onClick={() => void handleLookup()}
                disabled={oib.length !== 11}
                loading={lookupLoading}
                icon={<Search className="h-4 w-4" aria-hidden="true" />}
              >
                {lookupLoading
                  ? t("company.verification.step1_lookup_loading")
                  : t("company.verification.step1_lookup_btn")}
              </Button>
            </div>
          </div>

          {/* Steps 2 & 3: visible only after a successful lookup */}
          {snapshot ? (
            <>
              <SnapshotCard snapshot={snapshot} />
              <EmailPicker
                snapshot={snapshot}
                emailChoice={emailChoice}
                emailManual={emailManual}
                emailError={emailError}
                onEmailChoice={(value) => {
                  setEmailChoice(value);
                  setEmailError(null);
                }}
                onEmailManual={(value) => {
                  setEmailManual(value);
                  setEmailError(null);
                }}
                showDomainWarning={showDomainWarning}
              />
              <div className="flex justify-end">
                <Button
                  onClick={() => void handleSend()}
                  loading={sendLoading}
                  icon={<Mail className="h-4 w-4" aria-hidden="true" />}
                >
                  {sendLoading
                    ? t("company.verification.step3_send_loading")
                    : t("company.verification.step3_send_btn")}
                </Button>
              </div>
            </>
          ) : null}
        </Card>
      ) : null}

      {/* Cancelling a pending verification used to happen on a single click
          with no confirmation and no error handling. */}
      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t("company.verification.pending_cancel")}
        description={status?.verification?.contact_email ?? undefined}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => void handleCancel()}
              loading={cancelLoading}
              data-dialog-initial-focus
            >
              {t("common.confirm")}
            </Button>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              {t("common.cancel")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-secondary">
          {t("company.verification.pending_body")
            .replace("{email}", status?.verification?.contact_email ?? "—")
            .replace(
              "{expires}",
              status?.verification
                ? new Date(status.verification.expires_at).toLocaleString()
                : "—"
            )}
        </p>
      </Dialog>
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
    <Card padding="lg" className="border-success/30 bg-success-soft">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden="true" />
        <div className="flex-1">
          <h3 className="text-base font-semibold text-success-on-soft">
            {t("company.verification.verified_title")}
          </h3>
          <p className="mt-1 text-sm text-success-on-soft/90">
            {t("company.verification.verified_body")}
          </p>
          <p className="mt-2 text-sm text-success-on-soft/80">
            {t("company.verification.verified_at")} {new Date(verifiedAt).toLocaleString()}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {companySlug ? (
              <a
                href={`/company/${companySlug}`}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                {t("company.verification.go_to_company")}
              </a>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={onReverify}
              icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            >
              {t("company.verification.reverify")}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PendingCard({ v, onCancel }: { v: Verification; onCancel: () => void }) {
  const t = useT();
  return (
    <Card padding="lg" className="border-warning/30 bg-warning-soft">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 h-6 w-6 shrink-0 text-warning" aria-hidden="true" />
        <div className="flex-1">
          <h3 className="text-base font-semibold text-warning-on-soft">
            {t("company.verification.pending_title")}
          </h3>
          <p className="mt-1 text-sm text-warning-on-soft/90">
            {t("company.verification.pending_body")
              .replace("{email}", v.contact_email)
              .replace("{expires}", new Date(v.expires_at).toLocaleString())}
          </p>
          <div className="mt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={onCancel}
              icon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
            >
              {t("company.verification.pending_cancel")}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function SnapshotCard({ snapshot }: { snapshot: SudregSnapshot }) {
  const t = useT();
  const active = snapshot.status === 1;
  return (
    <div className="space-y-3 rounded-control border border-border-subtle bg-surface-sunken p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {t("company.verification.step2_title")}
        </h3>
        <Badge tone={active ? "success" : "danger"} size="sm">
          {active
            ? t("company.verification.step2_status_active")
            : t("company.verification.step2_status_inactive")}
        </Badge>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <DetailCell label={t("company.verification.step2_legal_name")} value={snapshot.legalName} />
        {snapshot.shortName ? (
          <DetailCell
            label={t("company.verification.step2_short_name")}
            value={snapshot.shortName}
          />
        ) : null}
        <DetailCell label={t("company.verification.step2_legal_form")} value={snapshot.legalForm} />
        <DetailCell
          label={t("company.verification.step2_address")}
          value={
            [snapshot.street, snapshot.city, snapshot.county].filter(Boolean).join(", ") || null
          }
        />
        <DetailCell label="OIB" value={snapshot.oib} mono />
        <DetailCell label={t("company.verification.step2_mb")} value={snapshot.mb} mono />
        <DetailCell label={t("company.verification.step2_mbs")} value={snapshot.mbs} mono />
      </dl>
    </div>
  );
}

function DetailCell({
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
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">{label}</dt>
      <dd className={clsx("mt-0.5 text-sm text-ink", mono && "font-mono")}>{value ?? "—"}</dd>
    </div>
  );
}

function EmailPicker({
  snapshot,
  emailChoice,
  emailManual,
  emailError,
  onEmailChoice,
  onEmailManual,
  showDomainWarning,
}: {
  snapshot: SudregSnapshot;
  emailChoice: string;
  emailManual: string;
  emailError: string | null;
  onEmailChoice: (v: string) => void;
  onEmailManual: (v: string) => void;
  showDomainWarning: boolean;
}) {
  const t = useT();
  const optionClass =
    "flex cursor-pointer items-center gap-3 rounded-control border border-border-subtle bg-surface-raised px-4 py-3 text-sm transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand-soft";

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">
        {t("company.verification.step3_title")}
      </h3>
      <p className="mt-1 text-sm text-ink-tertiary">
        {t("company.verification.step3_email_choose")}
      </p>
      <div className="mt-3 space-y-2">
        {snapshot.emails.map((e) => (
          <label key={e} className={optionClass}>
            <input
              type="radio"
              name="verify-email"
              value={e}
              checked={emailChoice === e}
              onChange={(ev) => onEmailChoice(ev.target.value)}
              className="h-4 w-4 accent-brand"
            />
            <span className="font-mono text-ink">{e}</span>
          </label>
        ))}
        {/* The address input is a sibling of the radio's label, not a child of
            it: a <label> inside a <label> is invalid and swallows clicks. */}
        <div className={clsx(optionClass, "flex-col items-stretch")}>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="verify-email"
              value="__manual__"
              checked={emailChoice === "__manual__"}
              onChange={(ev) => onEmailChoice(ev.target.value)}
              className="h-4 w-4 accent-brand"
            />
            <span className="font-medium text-ink">
              {t("company.verification.step3_email_other")}
            </span>
          </label>
          <div className="mt-2 pl-7">
            <Field
              label={
                <span className="sr-only">
                  {t("company.verification.step3_email_other")}
                </span>
              }
              error={emailError}
            >
              {(field) => (
                <Input
                  {...field}
                  type="email"
                  value={emailManual}
                  onChange={(e) => onEmailManual(e.target.value)}
                  placeholder={t("company.verification.step3_email_placeholder")}
                  invalid={!!emailError}
                />
              )}
            </Field>
            {showDomainWarning ? (
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-warning-on-soft">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {t("company.verification.email_warning_domain")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
