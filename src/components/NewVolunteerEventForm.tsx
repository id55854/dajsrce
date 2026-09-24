"use client";

import { useState } from "react";
import { CalendarPlus, X } from "lucide-react";
import { useT } from "@/i18n/client";
import { Button, Card, Field, Input, SectionHeader, Textarea, useToast } from "@/components/ui";

export function NewVolunteerEventForm({ panelId, onClose, onPosted }: {
  panelId: string;
  onClose: () => void;
  onPosted?: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [evTitle, setEvTitle] = useState("");
  const [evDescription, setEvDescription] = useState("");
  const [evDate, setEvDate] = useState("");
  const [evStart, setEvStart] = useState("09:00");
  const [evEnd, setEvEnd] = useState("12:00");
  const [evVolunteers, setEvVolunteers] = useState("5");
  // Empty means "at our address"; the organisation only types a place when
  // the event happens somewhere else.
  const [evLocation, setEvLocation] = useState("");
  const [evSubmitting, setEvSubmitting] = useState(false);
  const [evError, setEvError] = useState<string | null>(null);

  async function submitEvent(e: React.FormEvent) {
    e.preventDefault();
    setEvError(null);
    setEvSubmitting(true);
    try {
      const res = await fetch("/api/volunteer-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: evTitle,
          description: evDescription,
          event_date: evDate,
          start_time: evStart,
          end_time: evEnd,
          volunteers_needed: Number(evVolunteers),
          location: evLocation.trim() || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(
          (json as { error?: string }).error ?? t("institution.dashboard_error_event_failed")
        );
      }
      toast({
        tone: "success",
        title: t("institution.dashboard_toast_event_posted"),
        description: evTitle,
      });
      setEvTitle("");
      setEvDescription("");
      setEvDate("");
      setEvVolunteers("5");
      setEvLocation("");
      onClose();
      onPosted?.();
    } catch (err) {
      setEvError(
        err instanceof Error ? err.message : t("institution.dashboard_error_event_failed")
      );
    } finally {
      setEvSubmitting(false);
    }
  }

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
            disabled={evSubmitting}
            aria-label={t("institution.dashboard_close_event_aria")}
            icon={<X className="h-4 w-4" aria-hidden="true" />}
          >
            {t("common.close")}
          </Button>
        }
      />
      <form onSubmit={submitEvent} className="space-y-4">
        <FormError message={evError} />
        <Field
          label={t("institution.dashboard_field_title")}
          required
          requiredLabel={t("common.required")}
        >
          {(field) => (
            <Input
              {...field}
              required
              value={evTitle}
              onChange={(e) => setEvTitle(e.target.value)}
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
              rows={3}
              value={evDescription}
              onChange={(e) => setEvDescription(e.target.value)}
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
              type="date"
              required
              value={evDate}
              onChange={(e) => setEvDate(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("institution.dashboard_field_start")}>
            {(field) => (
              <Input
                {...field}
                type="time"
                value={evStart}
                onChange={(e) => setEvStart(e.target.value)}
              />
            )}
          </Field>
          <Field label={t("institution.dashboard_field_end")}>
            {(field) => (
              <Input
                {...field}
                type="time"
                value={evEnd}
                onChange={(e) => setEvEnd(e.target.value)}
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
              maxLength={300}
              placeholder={t("institution.dashboard_field_location_placeholder")}
              value={evLocation}
              onChange={(e) => setEvLocation(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("institution.dashboard_field_volunteers_needed")}
          required
          requiredLabel={t("common.required")}
        >
          {(field) => (
            <Input
              {...field}
              type="number"
              min={1}
              required
              value={evVolunteers}
              onChange={(e) => setEvVolunteers(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" fullWidth loading={evSubmitting}>
          {evSubmitting
            ? t("institution.dashboard_posting")
            : t("institution.dashboard_post_event")}
        </Button>
      </form>
    </Card>
  );
}

/** The one form-level error recipe for this page. */
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
