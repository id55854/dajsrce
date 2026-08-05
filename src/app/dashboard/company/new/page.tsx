"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Building2, Check } from "lucide-react";
import clsx from "clsx";
import { useT } from "@/i18n/client";
import { SIZE_CLASSES } from "@/lib/constants";
import type { SizeClass } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";

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
  const toast = useToast();
  const [step, setStep] = useState<Step>(0);

  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [oib, setOib] = useState("");
  const [oibState, setOibState] = useState<
    "idle" | "checking" | "valid" | "invalid" | "registry_hit"
  >("idle");
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
      // The toast provider lives in the root layout, so this survives the
      // navigation and lands on the dashboard the user just created.
      toast({ tone: "success", title: t("company.create_success"), description: legalName.trim() });
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

  const colorInputClass =
    "h-11 w-full cursor-pointer rounded-control border border-border-subtle bg-surface-raised p-1";

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Building2 className="h-7 w-7 shrink-0 text-brand" aria-hidden="true" />
            {t("company.onboarding_title")}
          </span>
        }
        subtitle={t("company.onboarding_intro")}
      />

      <div className="space-y-6">
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
          <div
            role="alert"
            className="rounded-control border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger-on-soft"
          >
            <p>{error}</p>
            {errorHint ? <p className="mt-2 leading-relaxed opacity-90">{errorHint}</p> : null}
          </div>
        ) : null}

        <Card padding="lg">
          {step === 0 ? (
            <div className="space-y-4">
              <Field
                label={t("company.legal_name_label")}
                required
                requiredLabel={t("common.required")}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="text"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    required
                  />
                )}
              </Field>
              <Field label={t("company.display_name_label")}>
                {(field) => (
                  <Input
                    {...field}
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={t("company.oib_label")}
                hint={t("company.oib_hint")}
                error={oibState === "invalid" ? t("company.oib_invalid") : null}
              >
                {(field) => (
                  <div className="flex flex-wrap items-start gap-2">
                    <Input
                      {...field}
                      type="text"
                      inputMode="numeric"
                      pattern="\d{11}"
                      maxLength={11}
                      value={oib}
                      invalid={oibState === "invalid"}
                      className="min-w-[10rem] flex-1 font-mono tracking-wider"
                      onChange={(e) => {
                        setOib(e.target.value.replace(/\D/g, ""));
                        setOibState("idle");
                      }}
                    />
                    <Button
                      variant="secondary"
                      onClick={() => void checkOib()}
                      disabled={oib.length !== 11}
                      loading={oibState === "checking"}
                    >
                      {t("common.confirm")}
                    </Button>
                  </div>
                )}
              </Field>
              {oibState === "registry_hit" && oibHit ? (
                <Badge
                  tone="success"
                  icon={<BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                  {oibHit.legalName}
                </Badge>
              ) : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <Field
                label={t("company.address_label")}
                required
                requiredLabel={t("common.required")}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    required
                  />
                )}
              </Field>
              <Field label={t("company.city_label")} required requiredLabel={t("common.required")}>
                {(field) => (
                  <Input
                    {...field}
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    required
                  />
                )}
              </Field>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("company.brand_primary_label")}>
                  {(field) => (
                    <input
                      {...field}
                      type="color"
                      value={brandPrimary}
                      onChange={(e) => setBrandPrimary(e.target.value)}
                      className={colorInputClass}
                    />
                  )}
                </Field>
                <Field label={t("company.brand_secondary_label")}>
                  {(field) => (
                    <input
                      {...field}
                      type="color"
                      value={brandSecondary}
                      onChange={(e) => setBrandSecondary(e.target.value)}
                      className={colorInputClass}
                    />
                  )}
                </Field>
              </div>
              <Field label={t("company.size_class_label")}>
                {(field) => (
                  <Select
                    {...field}
                    value={sizeClass}
                    onChange={(e) => setSizeClass(e.target.value as SizeClass | "")}
                  >
                    <option value="">—</option>
                    {(Object.keys(SIZE_CLASSES) as SizeClass[]).map((k) => (
                      <option key={k} value={k}>
                        {SIZE_CLASSES[k].label} · {SIZE_CLASSES[k].headcount}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label={t("company.prior_year_revenue_label")}
                hint={t("company.prior_year_revenue_hint")}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    min={0}
                    value={priorRevenue}
                    onChange={(e) => setPriorRevenue(e.target.value)}
                  />
                )}
              </Field>
            </div>
          ) : null}

          {step === 3 ? (
            <Field label={t("company.invite_emails_label")} hint={t("company.invite_note")}>
              {(field) => (
                <Textarea
                  {...field}
                  rows={3}
                  value={inviteEmails}
                  onChange={(e) => setInviteEmails(e.target.value)}
                  placeholder="ana@firma.hr, ivan@firma.hr"
                />
              )}
            </Field>
          ) : null}

          <div className="mt-6 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s))}
              disabled={step === 0 || loading}
            >
              {t("common.back")}
            </Button>
            {step < 3 ? (
              <Button
                onClick={() => canAdvance && setStep((s) => (s < 3 ? ((s + 1) as Step) : s))}
                disabled={!canAdvance}
              >
                {t("common.continue")}
              </Button>
            ) : (
              <Button
                onClick={() => void submit()}
                loading={loading}
                icon={<Check className="h-4 w-4" aria-hidden="true" />}
              >
                {t("company.create_cta")}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stepper({ step, labels }: { step: Step; labels: string[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs font-semibold">
      {labels.map((label, idx) => {
        const active = idx === step;
        const done = idx < step;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className={clsx(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5",
              active
                ? "bg-brand text-white"
                : done
                  ? "bg-success-soft text-success-on-soft"
                  : "bg-surface-sunken text-ink-tertiary"
            )}
          >
            <span
              className={clsx(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                active ? "bg-white/20" : done ? "bg-success/20" : "bg-border-strong"
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
