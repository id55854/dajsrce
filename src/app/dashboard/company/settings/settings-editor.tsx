"use client";

import { useEffect, useId, useState } from "react";
import clsx from "clsx";
import { BadgeCheck, Save, Settings as SettingsIcon } from "lucide-react";
import { useT, useLocale } from "@/i18n/client";
import { SIZE_CLASSES, SUBSCRIPTION_TIERS } from "@/lib/constants";
import { flags } from "@/lib/flags";
import type { Company, CompanyRole, SizeClass } from "@/lib/types";
import { ceilingPct, headroomEur } from "@/lib/tax";
import { useRouter, useSearchParams } from "next/navigation";
import { BillingPanel } from "./billing-panel";
import { CompanyVerificationSection } from "@/components/CompanyVerificationSection";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  SectionHeader,
  Select,
  useToast,
} from "@/components/ui";

type Props = {
  company: Company;
  myRole: CompanyRole;
  allowDemoBilling?: boolean;
};

type Tab = "general" | "verification";

const TABS: Tab[] = ["general", "verification"];

export function SettingsEditor({ company, myRole, allowDemoBilling = false }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const canManage = myRole === "owner" || myRole === "admin";
  const tabBaseId = useId();

  const [tab, setTab] = useState<Tab>(
    searchParams.get("verified") === "1" ? "verification" : "general"
  );

  // If the verify-company landing redirected here with ?verified=1, jump to
  // the verification tab so the user sees their freshly-stamped state.
  useEffect(() => {
    if (searchParams.get("verified") === "1") setTab("verification");
  }, [searchParams]);

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
  const [publicProfileEnabled, setPublicProfileEnabled] = useState(company.public_profile_enabled);

  const canPublicProfile =
    flags.publicProfileEnabled &&
    (SUBSCRIPTION_TIERS[company.subscription_tier]?.publicProfile ?? false);

  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
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
          public_profile_enabled: publicProfileEnabled,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Success and failure used to share one state and one grey style.
        toast({
          tone: "error",
          title: t("errors.generic_title"),
          description: typeof data.error === "string" ? data.error : t("common.error_generic"),
        });
        return;
      }
      toast({ tone: "success", title: t("common.saved") });
      router.refresh();
    } catch {
      toast({
        tone: "error",
        title: t("errors.generic_title"),
        description: t("common.error_generic"),
      });
    } finally {
      setSaving(false);
    }
  }

  const headroom = headroomEur(priorRevenue ? Number(priorRevenue) : null);
  const tabId = (name: Tab) => `${tabBaseId}-tab-${name}`;
  const panelId = (name: Tab) => `${tabBaseId}-panel-${name}`;

  function moveTab(direction: 1 | -1) {
    const index = TABS.indexOf(tab);
    const next = TABS[(index + direction + TABS.length) % TABS.length]!;
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  }

  return (
    <div>
      <PageHeader
        title={t("company.settings_title")}
        actions={
          company.verified_at ? (
            <Badge tone="success" icon={<BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />}>
              {t("company.verification.verified_badge")}
            </Badge>
          ) : undefined
        }
      />

      <nav
        className="mb-6 flex gap-1 rounded-full border border-border-subtle bg-surface-raised p-1 shadow-raised"
        role="tablist"
        aria-label={t("company.settings_title")}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            moveTab(1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveTab(-1);
          }
        }}
      >
        <TabButton
          id={tabId("general")}
          controls={panelId("general")}
          active={tab === "general"}
          onClick={() => setTab("general")}
        >
          <SettingsIcon className="h-4 w-4" aria-hidden="true" />
          {locale === "hr" ? "Postavke" : "Settings"}
        </TabButton>
        <TabButton
          id={tabId("verification")}
          controls={panelId("verification")}
          active={tab === "verification"}
          onClick={() => setTab("verification")}
        >
          <BadgeCheck className="h-4 w-4" aria-hidden="true" />
          {t("company.verification.tab_label")}
        </TabButton>
      </nav>

      {tab === "verification" ? (
        <div
          role="tabpanel"
          id={panelId("verification")}
          aria-labelledby={tabId("verification")}
          tabIndex={0}
        >
          <CompanyVerificationSection
            companyId={company.id}
            companySlug={company.slug}
            companyDomain={null}
          />
        </div>
      ) : (
        <div
          role="tabpanel"
          id={panelId("general")}
          aria-labelledby={tabId("general")}
          tabIndex={0}
          className="space-y-8"
        >
          <Card padding="lg">
            <SectionHeader title={t("company.settings_brand_section")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={locale === "hr" ? "Prikazni naziv" : "Display name"}>
                {(field) => (
                  <Input
                    {...field}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={!canManage}
                  />
                )}
              </Field>
              <Field label={locale === "hr" ? "Slogan" : "Tagline"}>
                {(field) => (
                  <Input
                    {...field}
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    disabled={!canManage}
                  />
                )}
              </Field>
              <Field label={t("company.address_label")}>
                {(field) => (
                  <Input
                    {...field}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    disabled={!canManage}
                  />
                )}
              </Field>
              <Field label={t("company.city_label")}>
                {(field) => (
                  <Input
                    {...field}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    disabled={!canManage}
                  />
                )}
              </Field>
              <Field label={t("company.brand_primary_label")}>
                {(field) => (
                  <input
                    {...field}
                    type="color"
                    className="h-11 w-full cursor-pointer rounded-control border border-border-subtle bg-surface-raised p-1 disabled:cursor-not-allowed disabled:opacity-60"
                    value={brandPrimary}
                    onChange={(e) => setBrandPrimary(e.target.value)}
                    disabled={!canManage}
                  />
                )}
              </Field>
              <Field label={t("company.brand_secondary_label")}>
                {(field) => (
                  <input
                    {...field}
                    type="color"
                    className="h-11 w-full cursor-pointer rounded-control border border-border-subtle bg-surface-raised p-1 disabled:cursor-not-allowed disabled:opacity-60"
                    value={brandSecondary}
                    onChange={(e) => setBrandSecondary(e.target.value)}
                    disabled={!canManage}
                  />
                )}
              </Field>
              <Field label={t("company.logo_label")} hint={t("company.logo_hint")}>
                {(field) => (
                  <Input
                    {...field}
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://…"
                    disabled={!canManage}
                  />
                )}
              </Field>
              <Field label={t("company.size_class_label")}>
                {(field) => (
                  <Select
                    {...field}
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
                  </Select>
                )}
              </Field>
            </div>
          </Card>

          {canPublicProfile && canManage ? (
            <Card padding="lg">
              <SectionHeader title={t("company.public_profile_section_title")} />
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-border-strong accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  checked={publicProfileEnabled}
                  onChange={(e) => setPublicProfileEnabled(e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-ink">
                    {t("company.public_profile_toggle")}
                  </span>
                  <span className="mt-1 block text-sm text-ink-secondary">
                    {t("company.public_profile_hint")}
                  </span>
                </span>
              </label>
              <div className="mt-6">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                  {t("company.public_profile_embed_title")}
                </h3>
                <p className="mt-1 text-sm text-ink-secondary">
                  {t("company.public_profile_embed_hint")}
                </p>
                <pre className="mt-2 overflow-x-auto rounded-control bg-surface-sunken p-3 text-xs text-ink">
                  {`<script src="${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") || "https://YOUR_APP_URL"}/company/${company.slug}/embed" async></script>`}
                </pre>
              </div>
            </Card>
          ) : null}

          <Card padding="lg">
            <SectionHeader title={t("company.settings_finance_section")} />
            <div className="grid gap-4 sm:grid-cols-2">
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
                    disabled={!canManage}
                  />
                )}
              </Field>
              <Field
                label={t("company.settings_match_ratio_label")}
                hint={t("company.settings_match_ratio_hint")}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    step="0.05"
                    min={0}
                    max={10}
                    value={matchRatio}
                    onChange={(e) => setMatchRatio(e.target.value)}
                    disabled={!canManage}
                  />
                )}
              </Field>
            </div>
            <p className="mt-4 rounded-control bg-surface-sunken p-3 text-sm text-ink-secondary">
              {t("tax.ceiling_hint", { pct: ceilingPct().toFixed(1) })}
              {" · "}
              {locale === "hr" ? "Gornji limit" : "Ceiling"}: {formatEur(headroom)}
            </p>
          </Card>

          <BillingPanel
            companyId={company.id}
            myRole={myRole}
            subscriptionTier={company.subscription_tier}
            allowDemoBilling={allowDemoBilling}
          />

          {canManage ? (
            <div className="flex justify-end">
              <Button
                onClick={() => void save()}
                loading={saving}
                icon={<Save className="h-4 w-4" aria-hidden="true" />}
              >
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TabButton({
  id,
  controls,
  active,
  onClick,
  children,
}: {
  id: string;
  controls: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={clsx(
        "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        "motion-safe:active:scale-[0.97]",
        active
          ? "bg-brand text-white shadow-raised"
          : "text-ink-secondary hover:bg-surface-sunken hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

function formatEur(value: number): string {
  if (!value || value <= 0) return "—";
  return new Intl.NumberFormat("hr-HR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}
