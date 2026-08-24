"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  CalendarPlus,
  ClipboardList,
  Inbox,
  MapPin,
  Plus,
  Users,
  X,
} from "lucide-react";
import { useLocale, useT } from "@/i18n/client";
import { DONATION_TYPES } from "@/lib/constants";
import type { DonationType, UrgencyLevel } from "@/lib/types";
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  PageShell,
  SectionHeader,
  Select,
  Stat,
  Textarea,
  buttonClasses,
  useToast,
} from "@/components/ui";

const donationKeys = Object.keys(DONATION_TYPES) as DonationType[];

export default function InstitutionDashboardPage() {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();

  const urgencyOptions: { value: UrgencyLevel; label: string }[] = [
    { value: "routine", label: t("institution.dashboard_urgency_routine") },
    { value: "needed_soon", label: t("institution.dashboard_urgency_needed_soon") },
    { value: "urgent", label: t("institution.dashboard_urgency_urgent") },
  ];
  const needPanelId = useId();
  const eventPanelId = useId();
  const [panel, setPanel] = useState<"need" | "event" | null>(null);

  const [needTitle, setNeedTitle] = useState("");
  const [needDescription, setNeedDescription] = useState("");
  const [needDonationType, setNeedDonationType] = useState<DonationType>("food");
  const [needUrgency, setNeedUrgency] = useState<UrgencyLevel>("routine");
  const [needQuantity, setNeedQuantity] = useState("1");
  const [needSubmitting, setNeedSubmitting] = useState(false);
  const [needError, setNeedError] = useState<string | null>(null);

  const [evTitle, setEvTitle] = useState("");
  const [evDescription, setEvDescription] = useState("");
  const [evDate, setEvDate] = useState("");
  const [evStart, setEvStart] = useState("09:00");
  const [evEnd, setEvEnd] = useState("12:00");
  const [evVolunteers, setEvVolunteers] = useState("5");
  const [evSubmitting, setEvSubmitting] = useState(false);
  const [evError, setEvError] = useState<string | null>(null);

  async function submitNeed(e: React.FormEvent) {
    e.preventDefault();
    setNeedError(null);
    setNeedSubmitting(true);
    try {
      const res = await fetch("/api/needs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: needTitle,
          description: needDescription,
          donation_type: needDonationType,
          urgency: needUrgency,
          quantity_needed: Number(needQuantity),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(
          (json as { error?: string }).error ?? t("institution.dashboard_error_need_failed")
        );
      }
      // Success used to replace the form with a green banner and then close the
      // panel on a 2s timer, so the content vanished from under the user. The
      // outcome is a toast; the panel closes because the task is finished.
      toast({
        tone: "success",
        title: t("institution.dashboard_toast_need_posted"),
        description: needTitle,
      });
      setNeedTitle("");
      setNeedDescription("");
      setNeedQuantity("1");
      setPanel(null);
    } catch (err) {
      setNeedError(
        err instanceof Error ? err.message : t("institution.dashboard_error_need_failed")
      );
    } finally {
      setNeedSubmitting(false);
    }
  }

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
      setPanel(null);
    } catch (err) {
      setEvError(
        err instanceof Error ? err.message : t("institution.dashboard_error_event_failed")
      );
    } finally {
      setEvSubmitting(false);
    }
  }

  return (
    <PageShell width="content">
      <PageHeader
        title={t("institution.dashboard_title")}
        subtitle={t("institution.dashboard_subtitle")}
        actions={
          <>
            <Link
              href="/dashboard/institution/pledges"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              <Inbox className="h-4 w-4" aria-hidden="true" />
              {t("institution.dashboard_nav_pledges")}
            </Link>
            <Link
              href="/dashboard/institution/volunteers"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              {t("institution.dashboard_nav_volunteers")}
            </Link>
          </>
        }
      />

      <div className="space-y-6">
        {/* NOTE: this figure has never had a query behind it. Rather than print
            a fabricated `0`, show an explicit em-dash and point at the pledges
            page, which does load real rows. */}
        <Stat
          label={t("institution.dashboard_stat_label")}
          tone="muted"
          value={
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">{t("institution.dashboard_stat_sr_not_available")}</span>
            </>
          }
          hint={
            <>
              {t("institution.dashboard_stat_hint")}{" "}
              <Link
                href="/dashboard/institution/pledges"
                className="rounded font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                {t("institution.dashboard_stat_see_all")}
              </Link>
            </>
          }
        />

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            size="lg"
            fullWidth
            aria-expanded={panel === "need"}
            aria-controls={needPanelId}
            onClick={() => {
              setNeedError(null);
              setPanel((current) => (current === "need" ? null : "need"));
            }}
            icon={<Plus className="h-5 w-5" aria-hidden="true" />}
          >
            {t("institution.dashboard_new_need")}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            fullWidth
            aria-expanded={panel === "event"}
            aria-controls={eventPanelId}
            onClick={() => {
              setEvError(null);
              setPanel((current) => (current === "event" ? null : "event"));
            }}
            icon={<CalendarPlus className="h-5 w-5" aria-hidden="true" />}
          >
            {t("institution.dashboard_new_event")}
          </Button>
        </div>

        {/* These were in-page cards wearing modal-weight `shadow-lg` with no
            focus move, no Escape, no scrim and no dialog role. They are honest
            inline sections now: normal card elevation and a real close button. */}
        {panel === "need" ? (
          <Card padding="lg" id={needPanelId}>
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
                  onClick={() => setPanel(null)}
                  aria-label={t("institution.dashboard_close_need_aria")}
                  icon={<X className="h-4 w-4" aria-hidden="true" />}
                >
                  {t("common.close")}
                </Button>
              }
            />
            <form onSubmit={submitNeed} className="space-y-4">
              <FormError message={needError} />
              <Field
                label={t("institution.dashboard_field_title")}
                required
                requiredLabel={t("common.required")}
              >
                {(field) => (
                  <Input
                    {...field}
                    required
                    value={needTitle}
                    onChange={(e) => setNeedTitle(e.target.value)}
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
                    value={needDescription}
                    onChange={(e) => setNeedDescription(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t("institution.dashboard_field_donation_type")}>
                {(field) => (
                  <Select
                    {...field}
                    value={needDonationType}
                    onChange={(e) => setNeedDonationType(e.target.value as DonationType)}
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
                        checked={needUrgency === o.value}
                        onChange={() => setNeedUrgency(o.value)}
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
                    value={needQuantity}
                    onChange={(e) => setNeedQuantity(e.target.value)}
                  />
                )}
              </Field>
              <Button type="submit" fullWidth loading={needSubmitting}>
                {needSubmitting
                  ? t("institution.dashboard_posting")
                  : t("institution.dashboard_post_need")}
              </Button>
            </form>
          </Card>
        ) : null}

        {panel === "event" ? (
          <Card padding="lg" id={eventPanelId}>
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
                  onClick={() => setPanel(null)}
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
        ) : null}

        <div>
          <Link
            href="/"
            className={buttonClasses({ variant: "primary", size: "lg", className: "w-full sm:w-auto" })}
          >
            <MapPin className="h-5 w-5" aria-hidden="true" />
            {t("institution.dashboard_view_map")}
          </Link>
        </div>
      </div>
    </PageShell>
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
