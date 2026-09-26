"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { CalendarPlus, X } from "lucide-react";
import { useT } from "@/i18n/client";
import { Button, Card, Field, Input, SectionHeader, Textarea, useToast } from "@/components/ui";
import type { VolunteerEventField } from "@/lib/validation";
import { zagrebToday } from "@/lib/volunteer-events";
import {
  patchMovesEvent,
  volunteerEventBody,
  volunteerEventErrorField,
  volunteerEventErrorKey,
  volunteerEventFormValues,
  volunteerEventPatch,
  type StoredVolunteerEvent,
  type VolunteerEventFormValues,
} from "@/lib/volunteer-event-patch";

export type { StoredVolunteerEvent } from "@/lib/volunteer-event-patch";

/**
 * Publishes a new volunteer event, or with `event` edits that one in place.
 *
 * Editing sends only the fields that changed: the transaction tells every
 * signed-up volunteer when the date, time or place moves, so resending an
 * unchanged value would notify them about nothing. Capacity cannot go below
 * the people already signed up (`signedUp`); the transaction enforces the
 * same rule under a row lock.
 */
export function NewVolunteerEventForm({
  panelId,
  onClose,
  onPosted,
  event,
  signedUp = 0,
  onSaved,
}: {
  panelId?: string;
  onClose: () => void;
  onPosted?: () => void;
  /** Edit this event instead of publishing a new one. The form renders bare, for a dialog. */
  event?: StoredVolunteerEvent;
  /** Active signups on `event`. */
  signedUp?: number;
  onSaved?: (event: StoredVolunteerEvent) => void;
}) {
  const t = useT();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const editing = Boolean(event);
  const [values, setValues] = useState<VolunteerEventFormValues>(() => volunteerEventFormValues(event));
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const invalidField = errorKey ? volunteerEventErrorField(errorKey) : null;
  const minimumVolunteers = Math.max(1, signedUp);

  // Editing replaces the details the organisation was reading, whose control
  // just unmounted; put focus on the first field instead of losing it.
  useEffect(() => {
    if (editing) formRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  }, [editing]);

  function change(field: VolunteerEventField) {
    return (input: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((current) => ({ ...current, [field]: input.target.value }));
  }

  /** Marks the field an error is about, so it reads as the one to fix. */
  function invalid(field: VolunteerEventField) {
    return invalidField === field ? { invalid: true, "aria-invalid": true as const } : {};
  }

  function fail(key: string) {
    setErrorKey(key);
    // Move to the field to fix, or to the message when it is about the form.
    requestAnimationFrame(() => {
      const target = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]');
      target?.focus();
    });
  }

  async function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault();
    setErrorKey(null);
    if (event && Number(values.volunteers_needed) < signedUp) {
      fail("volunteer_form.error_below_signups");
      return;
    }
    const patch = event ? volunteerEventPatch(event, values) : null;
    if (patch && Object.keys(patch).length === 0) {
      toast({ tone: "info", title: t("volunteer_form.no_changes") });
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(event ? `/api/volunteer-events/${event.id}` : "/api/volunteer-events", {
        method: event ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch ?? volunteerEventBody(values)),
      });
      const json = (await res.json().catch(() => null)) as
        | { event?: StoredVolunteerEvent; field?: unknown; code?: unknown }
        | null;
      if (!res.ok) {
        fail(
          volunteerEventErrorKey(
            editing ? "edit" : "create",
            res.status,
            json,
            editing ? "volunteer_form.error_save_failed" : "institution.dashboard_error_event_failed"
          )
        );
        return;
      }
      if (event) {
        toast({
          tone: "success",
          title: t("volunteer_form.saved"),
          description: patch && patchMovesEvent(patch) && signedUp > 0 ? t("volunteer_form.saved_notified") : undefined,
        });
        // The transaction answers with the stored row; the patch is the
        // fallback if an older deployment answers without it.
        onSaved?.({ ...event, ...(json?.event ?? patch) } as StoredVolunteerEvent);
        onClose();
        return;
      }
      toast({
        tone: "success",
        title: t("institution.dashboard_toast_event_posted"),
        description: values.title,
      });
      setValues(volunteerEventFormValues());
      onClose();
      onPosted?.();
    } catch {
      fail(editing ? "volunteer_form.error_save_failed" : "institution.dashboard_error_event_failed");
    } finally {
      setSubmitting(false);
    }
  }

  const form = (
    <form ref={formRef} onSubmit={submit} className="space-y-4">
      <Field
        label={t("institution.dashboard_field_title")}
        required
        requiredLabel={t("common.required")}
      >
        {(field) => (
          <Input
            {...field}
            {...invalid("title")}
            required
            maxLength={160}
            value={values.title}
            onChange={change("title")}
          />
        )}
      </Field>
      <Field
        label={t("institution.dashboard_field_description")}
        hint={t("common.optional")}
      >
        {(field) => (
          <Textarea
            {...field}
            {...invalid("description")}
            rows={3}
            maxLength={4000}
            value={values.description}
            onChange={change("description")}
          />
        )}
      </Field>
      <Field
        label={t("institution.dashboard_field_date")}
        required
        requiredLabel={t("common.required")}
      >
        {(field) => (
          <Input
            {...field}
            {...invalid("event_date")}
            type="date"
            required
            // An event dated in the past would be invisible and unjoinable.
            min={zagrebToday()}
            value={values.event_date}
            onChange={change("event_date")}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("institution.dashboard_field_start")}>
          {(field) => (
            <Input
              {...field}
              {...invalid("start_time")}
              type="time"
              required
              value={values.start_time}
              onChange={change("start_time")}
            />
          )}
        </Field>
        <Field label={t("institution.dashboard_field_end")}>
          {(field) => (
            <Input
              {...field}
              {...invalid("end_time")}
              type="time"
              required
              value={values.end_time}
              onChange={change("end_time")}
            />
          )}
        </Field>
      </div>
      <Field
        label={t("institution.dashboard_field_location")}
        hint={t("institution.dashboard_field_location_hint")}
      >
        {(field) => (
          <Input
            {...field}
            {...invalid("location")}
            maxLength={300}
            placeholder={t("institution.dashboard_field_location_placeholder")}
            value={values.location}
            onChange={change("location")}
          />
        )}
      </Field>
      <Field
        label={t("institution.dashboard_field_volunteers_needed")}
        hint={editing && signedUp > 0 ? t("volunteer_form.volunteers_signed_hint", { count: signedUp }) : undefined}
        required
        requiredLabel={t("common.required")}
      >
        {(field) => (
          <Input
            {...field}
            {...invalid("volunteers_needed")}
            type="number"
            min={minimumVolunteers}
            max={10000}
            required
            value={values.volunteers_needed}
            onChange={change("volunteers_needed")}
          />
        )}
      </Field>
      <Field label={t("volunteer_form.field_requirements")} hint={t("common.optional")}>
        {(field) => (
          <Textarea
            {...field}
            {...invalid("requirements")}
            rows={2}
            maxLength={2000}
            placeholder={t("volunteer_form.field_requirements_placeholder")}
            value={values.requirements}
            onChange={change("requirements")}
          />
        )}
      </Field>
      <div className="space-y-1.5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("volunteer_form.field_contact_person")}>
            {(field) => (
              <Input
                {...field}
                {...invalid("contact_person")}
                maxLength={120}
                autoComplete="name"
                value={values.contact_person}
                onChange={change("contact_person")}
              />
            )}
          </Field>
          <Field label={t("volunteer_form.field_contact_phone")}>
            {(field) => (
              <Input
                {...field}
                {...invalid("contact_phone")}
                type="tel"
                inputMode="tel"
                maxLength={40}
                autoComplete="tel"
                value={values.contact_phone}
                onChange={change("contact_phone")}
              />
            )}
          </Field>
        </div>
        {/* The contact is published with the event, and the person it names
            should know that before the organisation types them in. */}
        <p className="text-sm text-ink-tertiary">{t("volunteer_form.contact_hint")}</p>
      </div>
      <FormError message={errorKey ? t(errorKey, { count: signedUp }) : null} />
      {editing ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" fullWidth loading={submitting}>
            {submitting ? t("volunteer_form.saving") : t("volunteer_form.save")}
          </Button>
          <Button type="button" variant="secondary" fullWidth disabled={submitting} onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      ) : (
        <Button type="submit" fullWidth loading={submitting}>
          {submitting
            ? t("institution.dashboard_posting")
            : t("institution.dashboard_post_event")}
        </Button>
      )}
    </form>
  );

  // Editing happens inside the event's own dialog, which already has a title
  // and a close control.
  if (editing) return form;

  return (
    <Card padding="lg" id={panelId}>
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-brand" aria-hidden="true" />
            {t("institution.dashboard_new_event")}
          </span>
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={submitting}
            aria-label={t("institution.dashboard_close_event_aria")}
            icon={<X className="h-4 w-4" aria-hidden="true" />}
          >
            {t("common.close")}
          </Button>
        }
      />
      {form}
    </Card>
  );
}

/** The one form-level error recipe for this page. */
function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      tabIndex={-1}
      className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-on-soft outline-none"
    >
      {message}
    </p>
  );
}
