"use client";

import { useState } from "react";
import { ClipboardList, Pencil, X } from "lucide-react";
import { useLocale, useT } from "@/i18n/client";
import { DONATION_TYPES } from "@/lib/constants";
import {
  NEED_LIMITS,
  NEW_NEED_DONATION_TYPES,
  needErrorKey,
  parseNeedPatch,
} from "@/lib/need-patch";
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

const URGENCIES: readonly UrgencyLevel[] = ["routine", "needed_soon", "urgent"];

/** A need as the organisation's own roster holds it, to edit in place. */
export type EditableNeed = {
  id: string;
  title: string;
  description?: string | null;
  donation_type?: string | null;
  urgency?: string | null;
  quantity_needed?: number | null;
  quantity_pledged?: number | null;
  deadline?: string | null;
};

/** What `update_need_transaction` returns. */
export type SavedNeed = {
  id: string;
  institution_id: string;
  title: string;
  description: string | null;
  donation_type: string;
  urgency: UrgencyLevel;
  quantity_needed: number | null;
  quantity_pledged: number;
  deadline: string | null;
  is_fulfilled: boolean;
  created_at: string;
};

function initialUrgency(need?: EditableNeed | null): UrgencyLevel {
  return URGENCIES.includes(need?.urgency as UrgencyLevel) ? (need!.urgency as UrgencyLevel) : "routine";
}

/**
 * The "post a new need" panel, and the same panel for correcting one. An NGO
 * account reaches it from its own dashboard and the Donate page's needs view;
 * so the form itself lives here once and each caller only owns the toggle
 * that opens it. With `need` set it edits that need in place instead of the
 * old delete-and-repost, which cascaded every pledge away.
 */
export function NewNeedForm({
  panelId,
  onClose,
  onPosted,
  need = null,
  onSaved,
}: {
  panelId: string;
  onClose: () => void;
  onPosted?: () => void;
  /** Edit this need instead of posting a new one. */
  need?: EditableNeed | null;
  onSaved?: (need: SavedNeed) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const editing = need !== null;

  const urgencyOptions: { value: UrgencyLevel; label: string }[] = [
    { value: "routine", label: t("institution.dashboard_urgency_routine") },
    { value: "needed_soon", label: t("institution.dashboard_urgency_needed_soon") },
    { value: "urgent", label: t("institution.dashboard_urgency_urgent") },
  ];

  const [title, setTitle] = useState(need?.title ?? "");
  const [description, setDescription] = useState(need?.description ?? "");
  const [donationType, setDonationType] = useState<DonationType>("food");
  const [urgency, setUrgency] = useState<UrgencyLevel>(() => initialUrgency(need));
  const [deadline, setDeadline] = useState(need?.deadline?.slice(0, 10) ?? "");
  const [quantity, setQuantity] = useState(
    editing ? (need?.quantity_needed != null ? String(need.quantity_needed) : "") : "1"
  );
  const [submitting, setSubmitting] = useState(false);
  // A translation key, so a locale switch re-renders the message.
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const pledged = need?.quantity_pledged ?? 0;
  const lockedType =
    editing && need?.donation_type && need.donation_type in DONATION_TYPES
      ? DONATION_TYPES[need.donation_type as DonationType]
      : null;

  async function create() {
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
        deadline: deadline || null,
      }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { code?: string; field?: string };
      setErrorKey(needErrorKey({ status: res.status, code: json.code, field: json.field }, "create"));
      return;
    }
    toast({
      tone: "success",
      title: t("institution.dashboard_toast_need_posted"),
      description: title,
    });
    setTitle("");
    setDescription("");
    setQuantity("1");
    setDeadline("");
    onClose();
    onPosted?.();
  }

  async function save(current: EditableNeed) {
    // Only what changed: an untouched field is not rewritten, and nothing is
    // sent at all when nothing changed.
    const nextQuantity = quantity.trim() === "" ? null : Number(quantity);
    const patch: Record<string, unknown> = {};
    if (title.trim() !== current.title.trim()) patch.title = title;
    if ((description.trim() || null) !== (current.description?.trim() || null)) patch.description = description;
    if (urgency !== initialUrgency(current)) patch.urgency = urgency;
    if (nextQuantity !== (current.quantity_needed ?? null)) patch.quantity_needed = nextQuantity;
    if ((deadline || null) !== (current.deadline?.slice(0, 10) || null)) patch.deadline = deadline || null;
    if (Object.keys(patch).length === 0) {
      toast({ tone: "info", title: t("institution.need_edit_no_changes") });
      onClose();
      return;
    }
    const checked = parseNeedPatch(patch);
    if (!checked.ok) {
      setErrorKey(needErrorKey({ status: 400, field: checked.field }, "update"));
      return;
    }
    if (checked.value.quantity_needed != null && checked.value.quantity_needed < pledged) {
      setErrorKey(needErrorKey({ status: 409, code: "quantity_below_pledged" }, "update"));
      return;
    }
    const res = await fetch(`/api/needs/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(checked.value),
    });
    const json = (await res.json().catch(() => ({}))) as { need?: SavedNeed; code?: string; field?: string };
    if (!res.ok || !json.need) {
      setErrorKey(needErrorKey({ status: res.ok ? 500 : res.status, code: json.code, field: json.field }, "update"));
      return;
    }
    toast({ tone: "success", title: t("institution.need_edit_saved"), description: json.need.title });
    onSaved?.(json.need);
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    setSubmitting(true);
    try {
      if (need) await save(need);
      else await create();
    } catch {
      setErrorKey(editing ? "institution.need_update_failed" : "institution.dashboard_error_need_failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card padding="lg" id={panelId}>
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            {editing ? (
              <Pencil className="h-5 w-5 text-brand" aria-hidden="true" />
            ) : (
              <ClipboardList className="h-5 w-5 text-brand" aria-hidden="true" />
            )}
            {editing ? t("institution.need_edit_title") : t("institution.dashboard_new_need")}
          </span>
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={
              editing ? t("institution.need_edit_close_aria") : t("institution.dashboard_close_need_aria")
            }
            icon={<X className="h-4 w-4" aria-hidden="true" />}
          >
            {t("common.close")}
          </Button>
        }
      />
      <form onSubmit={submit} className="space-y-4">
        <FormError message={errorKey ? t(errorKey) : null} />
        <Field
          label={t("institution.dashboard_field_title")}
          required
          requiredLabel={t("common.required")}
        >
          {(field) => (
            <Input
              {...field}
              required
              maxLength={NEED_LIMITS.title}
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
              maxLength={NEED_LIMITS.description}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        {editing ? (
          // Pledges were made for this kind of help, so it stays as posted.
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-ink">{t("institution.dashboard_field_donation_type")}</p>
            <p className="text-base text-ink">
              {lockedType ? (locale === "hr" ? lockedType.labelHr : lockedType.label) : "—"}
            </p>
            <p className="text-sm text-ink-tertiary">{t("institution.need_edit_type_locked")}</p>
          </div>
        ) : (
          <Field
            label={t("institution.dashboard_field_donation_type")}
            hint={t("institution.need_money_unavailable")}
          >
            {(field) => (
              <Select
                {...field}
                value={donationType}
                onChange={(e) => setDonationType(e.target.value as DonationType)}
              >
                {NEW_NEED_DONATION_TYPES.map((key) => (
                  <option key={key} value={key}>
                    {locale === "hr" ? DONATION_TYPES[key].labelHr : DONATION_TYPES[key].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
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
                  name={`${panelId}-urgency`}
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
          required={!editing || need?.quantity_needed != null}
          requiredLabel={t("common.required")}
          hint={editing && pledged > 0 ? t("institution.need_edit_quantity_hint", { pledged }) : undefined}
        >
          {(field) => (
            <Input
              {...field}
              type="number"
              min={Math.max(1, pledged)}
              max={NEED_LIMITS.quantityMax}
              required={!editing || need?.quantity_needed != null}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("profile_calendar.deadline_field")} hint={t("profile_calendar.deadline_hint")}>
          {(field) => <Input {...field} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}
        </Field>
        <Button type="submit" fullWidth loading={submitting}>
          {editing
            ? submitting
              ? t("common.saving")
              : t("institution.need_edit_save")
            : submitting
              ? t("institution.dashboard_posting")
              : t("institution.dashboard_post_need")}
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
