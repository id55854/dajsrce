"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Building2, X } from "lucide-react";
import { useLocale, useT } from "@/i18n/client";
import { DONATION_TYPES } from "@/lib/constants";
import type { PublicInstitutionDetail } from "@/lib/location-map";
import type { DonationType } from "@/lib/types";
import {
  PROFILE_LIMITS,
  applyProfileResult,
  changedProfileFields,
  institutionProfileErrorKey,
  isInstitutionProfileField,
  missingProfileEssentials,
  parseInstitutionProfilePatch,
  profileDraftFrom,
  type InstitutionProfileDraft,
  type InstitutionProfileField,
  type InstitutionProfileResult,
} from "@/lib/institution-profile";
import {
  Button,
  Card,
  Field,
  Input,
  SectionHeader,
  Textarea,
  useToast,
} from "@/components/ui";

const DONATION_KEYS = Object.keys(DONATION_TYPES) as DonationType[];

type SaveError = { field: InstitutionProfileField | null; key: string };

/**
 * The organisation's own edit of its public profile.
 *
 * An approved claim builds the profile from register facts: register legalese
 * for a description, a possibly stale e-mail, and no phone, hours or accepted
 * donation types. Those are exactly what a donor needs after pledging, so this
 * panel is how the organisation fills them in. Only changed fields are sent,
 * which matters most for the donation types: sending an untouched list would
 * record a guess as the organisation's own confirmation.
 */
export function InstitutionProfileEditor({
  panelId,
  institution,
  onClose,
  onSaved,
}: {
  panelId: string;
  institution: PublicInstitutionDetail;
  onClose: () => void;
  onSaved: (institution: PublicInstitutionDetail) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const initial = useMemo(() => profileDraftFrom(institution), [institution]);
  const [draft, setDraft] = useState<InstitutionProfileDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaveError | null>(null);

  function update<K extends keyof InstitutionProfileDraft>(key: K, value: InstitutionProfileDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (saveError?.field === key) setSaveError(null);
  }

  function toggleDonationType(type: DonationType) {
    update(
      "accepts_donations",
      draft.accepts_donations.includes(type)
        ? draft.accepts_donations.filter((value) => value !== type)
        : DONATION_KEYS.filter((key) => key === type || draft.accepts_donations.includes(key))
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaveError(null);
    const patch = changedProfileFields(initial, draft);
    if (Object.keys(patch).length === 0) {
      toast({ tone: "info", title: t("institution_profile.no_changes") });
      onClose();
      return;
    }
    // The same rules the route and the database apply, checked here first so
    // the message can sit next to the field that caused it.
    const checked = parseInstitutionProfilePatch(patch);
    if (!checked.ok) {
      setSaveError({ field: checked.field, key: institutionProfileErrorKey(400, checked.field) });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/institution", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checked.value),
      });
      const json = (await res.json().catch(() => null)) as {
        institution?: InstitutionProfileResult;
        field?: unknown;
      } | null;
      if (!res.ok || !json?.institution) {
        const field = isInstitutionProfileField(json?.field) ? json.field : null;
        setSaveError({ field, key: institutionProfileErrorKey(res.ok ? 500 : res.status, field) });
        return;
      }
      onSaved(applyProfileResult(institution, json.institution));
      toast({ tone: "success", title: t("institution_profile.saved") });
      onClose();
    } catch {
      setSaveError({ field: null, key: "institution_profile.error_network" });
    } finally {
      setSaving(false);
    }
  }

  const errorFor = (field: InstitutionProfileField) =>
    saveError?.field === field ? t(saveError.key) : undefined;

  return (
    <Card padding="lg" id={panelId}>
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-brand" aria-hidden="true" />
            {t("institution_profile.title")}
          </span>
        }
        description={t("institution_profile.subtitle")}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={t("institution_profile.close_aria")}
            icon={<X className="h-4 w-4" aria-hidden="true" />}
          >
            {t("common.close")}
          </Button>
        }
      />
      <form onSubmit={submit} className="space-y-4" noValidate>
        {saveError && saveError.field === null ? (
          <p
            role="alert"
            className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
          >
            {t(saveError.key)}
          </p>
        ) : null}

        <Field
          label={t("institution_profile.description")}
          hint={t("institution_profile.description_hint")}
          error={errorFor("description")}
        >
          {(field) => (
            <Textarea
              {...field}
              rows={5}
              maxLength={PROFILE_LIMITS.description}
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("institution_profile.phone")} error={errorFor("phone")}>
            {(field) => (
              <Input
                {...field}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={PROFILE_LIMITS.phoneMax}
                placeholder={t("institution_profile.phone_placeholder")}
                value={draft.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("institution_profile.email")} error={errorFor("email")}>
            {(field) => (
              <Input
                {...field}
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={PROFILE_LIMITS.email}
                value={draft.email}
                onChange={(e) => update("email", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("institution_profile.website")} error={errorFor("website")}>
            {(field) => (
              // Plain text, not type="url": the browser would refuse the
              // "www.udruga.hr" people actually type, which is normalised on save.
              <Input
                {...field}
                type="text"
                inputMode="url"
                autoComplete="url"
                maxLength={PROFILE_LIMITS.website}
                placeholder={t("institution_profile.website_placeholder")}
                value={draft.website}
                onChange={(e) => update("website", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("institution_profile.working_hours")} error={errorFor("working_hours")}>
            {(field) => (
              <Input
                {...field}
                maxLength={PROFILE_LIMITS.hours}
                placeholder={t("institution_profile.working_hours_placeholder")}
                value={draft.working_hours}
                onChange={(e) => update("working_hours", e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label={t("institution_profile.drop_off_hours")}
          hint={t("institution_profile.drop_off_hours_hint")}
          error={errorFor("drop_off_hours")}
        >
          {(field) => (
            <Textarea
              {...field}
              rows={2}
              maxLength={PROFILE_LIMITS.hours}
              placeholder={t("institution_profile.drop_off_hours_placeholder")}
              value={draft.drop_off_hours}
              onChange={(e) => update("drop_off_hours", e.target.value)}
            />
          )}
        </Field>

        <fieldset aria-describedby={`${panelId}-accepts-hint`}>
          <legend className="text-sm font-medium text-ink">{t("institution_profile.accepts")}</legend>
          <p id={`${panelId}-accepts-hint`} className="mt-1 text-sm text-ink-tertiary">
            {t("institution_profile.accepts_hint")}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {DONATION_KEYS.map((type) => (
              <label
                key={type}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-border-subtle px-3 py-2 text-sm text-ink transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand-on-soft"
              >
                <input
                  type="checkbox"
                  checked={draft.accepts_donations.includes(type)}
                  onChange={() => toggleDonationType(type)}
                  className="h-4 w-4 accent-brand"
                />
                {locale === "hr" ? DONATION_TYPES[type].labelHr : DONATION_TYPES[type].label}
              </label>
            ))}
          </div>
          {saveError?.field === "accepts_donations" ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {t(saveError.key)}
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" loading={saving} className="sm:flex-1">
            {saving ? t("common.saving") : t("institution_profile.save")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Shown above the dashboard while the profile lacks what a donor needs to
 * hand something over. It names what is missing rather than nagging in
 * general, and disappears once all three are filled in.
 */
export function ProfileCompletionPrompt({
  institution,
  panelId,
  onOpen,
}: {
  institution: PublicInstitutionDetail;
  panelId: string;
  onOpen: () => void;
}) {
  const t = useT();
  const missing = missingProfileEssentials(institution);
  if (missing.length === 0) return null;
  return (
    <section
      aria-labelledby={`${panelId}-prompt-title`}
      className="flex flex-col gap-3 rounded-card border border-warning/30 bg-warning-soft p-4 text-warning-on-soft sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id={`${panelId}-prompt-title`} className="text-sm font-semibold">
            {t("institution_profile.prompt_title")}
          </h2>
          <p className="mt-1 text-sm">
            {t("institution_profile.prompt_body", {
              missing: missing.map((item) => t(`institution_profile.missing_${item}`)).join(", "),
            })}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={onOpen}
        aria-controls={panelId}
        className="shrink-0"
      >
        {t("institution_profile.prompt_action")}
      </Button>
    </section>
  );
}
