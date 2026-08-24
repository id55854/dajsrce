"use client";

import { useState } from "react";
import { ClipboardList, X } from "lucide-react";
import { useLocale, useT } from "@/i18n/client";
import { DONATION_TYPES } from "@/lib/constants";
import type { DonationType, UrgencyLevel } from "@/lib/types";
import {
  Button,
  Card,
  Field,
  Input,
  SectionHeader,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";

const donationKeys = Object.keys(DONATION_TYPES) as DonationType[];

/**
 * The "post a new need" panel. An NGO account reaches it from two places —
 * its own dashboard and the Donate page's needs view — so the form itself
 * lives here once and each caller only owns the toggle that opens it.
 */
export function NewNeedForm({
  panelId,
  onClose,
  onPosted,
}: {
  panelId: string;
  onClose: () => void;
  onPosted?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();

  const urgencyOptions: { value: UrgencyLevel; label: string }[] = [
    { value: "routine", label: t("institution.dashboard_urgency_routine") },
    { value: "needed_soon", label: t("institution.dashboard_urgency_needed_soon") },
    { value: "urgent", label: t("institution.dashboard_urgency_urgent") },
  ];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [donationType, setDonationType] = useState<DonationType>("food");
  const [urgency, setUrgency] = useState<UrgencyLevel>("routine");
  const [quantity, setQuantity] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/needs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title,
          description,
          donation_type: donationType,
          urgency,
          quantity_needed: Number(quantity),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(
          (json as { error?: string }).error ?? t("institution.dashboard_error_need_failed")
        );
      }
      toast({
        tone: "success",
        title: t("institution.dashboard_toast_need_posted"),
        description: title,
      });
      setTitle("");
      setDescription("");
      setQuantity("1");
      onClose();
      onPosted?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("institution.dashboard_error_need_failed")
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card padding="lg" id={panelId}>
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-brand" aria-hidden="true" />
            {t("institution.dashboard_new_need")}
          </span>
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={t("institution.dashboard_close_need_aria")}
            icon={<X className="h-4 w-4" aria-hidden="true" />}
          >
            {t("common.close")}
          </Button>
        }
      />
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field
          label={t("institution.dashboard_field_title")}
          required
          requiredLabel={t("common.required")}
        >
          {(field) => (
            <Input
              {...field}
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("institution.dashboard_field_description")} hint={t("common.optional")}>
          {(field) => (
            <Textarea
              {...field}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("institution.dashboard_field_donation_type")}>
          {(field) => (
            <Select
              {...field}
              value={donationType}
              onChange={(e) => setDonationType(e.target.value as DonationType)}
            >
              {donationKeys.map((key) => (
                <option key={key} value={key}>
                  {locale === "hr" ? DONATION_TYPES[key].labelHr : DONATION_TYPES[key].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">
            {t("institution.dashboard_field_urgency")}
          </legend>
          <div className="flex flex-wrap gap-3">
            {urgencyOptions.map((o) => (
              <label
                key={o.value}
                className="inline-flex cursor-pointer items-center gap-2 rounded-control border border-border-subtle px-3 py-2 text-sm text-ink transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand-on-soft"
              >
                <input
                  type="radio"
                  name="urgency"
                  value={o.value}
                  checked={urgency === o.value}
                  onChange={() => setUrgency(o.value)}
                  className="h-4 w-4 accent-brand"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          label={t("institution.dashboard_field_quantity")}
          required
          requiredLabel={t("common.required")}
        >
          {(field) => (
            <Input
              {...field}
              type="number"
              min={1}
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" fullWidth loading={submitting}>
          {submitting ? t("institution.dashboard_posting") : t("institution.dashboard_post_need")}
        </Button>
      </form>
    </Card>
  );
}

/** The one form-level error recipe for this panel. */
function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
    >
      {message}
    </p>
  );
}
