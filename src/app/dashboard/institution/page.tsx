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

// NOTE: every string on this page is hardcoded English. It predates the i18n
// layer and needs roughly 30 keys under an `institution_dashboard.*` namespace;
// translating it is tracked separately so this pass could stay presentational.

const donationEntries = Object.entries(DONATION_TYPES) as [
  DonationType,
  { label: string },
][];

const urgencyOptions: { value: UrgencyLevel; label: string }[] = [
  { value: "routine", label: "Routine" },
  { value: "needed_soon", label: "Needed soon" },
  { value: "urgent", label: "Urgent" },
];

export default function InstitutionDashboardPage() {
  const toast = useToast();
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
        throw new Error((json as { error?: string }).error ?? "Failed to post need");
      }
      // Success used to replace the form with a green banner and then close the
      // panel on a 2s timer, so the content vanished from under the user. The
      // outcome is a toast; the panel closes because the task is finished.
      toast({ tone: "success", title: "Need posted", description: needTitle });
      setNeedTitle("");
      setNeedDescription("");
      setNeedQuantity("1");
      setPanel(null);
    } catch (err) {
      setNeedError(err instanceof Error ? err.message : "Failed to post need");
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
        throw new Error((json as { error?: string }).error ?? "Failed to post event");
      }
      toast({ tone: "success", title: "Volunteer event posted", description: evTitle });
      setEvTitle("");
      setEvDescription("");
      setEvDate("");
      setEvVolunteers("5");
      setPanel(null);
    } catch (err) {
      setEvError(err instanceof Error ? err.message : "Failed to post event");
    } finally {
      setEvSubmitting(false);
    }
  }

  return (
    <PageShell width="content">
      <PageHeader
        title="Institution Management"
        subtitle="Manage needs, events, and activities."
        actions={
          <>
            <Link
              href="/dashboard/institution/pledges"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              <Inbox className="h-4 w-4" aria-hidden="true" />
              Pledges
            </Link>
            <Link
              href="/dashboard/institution/volunteers"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              Volunteers
            </Link>
          </>
        }
      />

      <div className="space-y-6">
        {/* NOTE: this figure has never had a query behind it. Rather than print
            a fabricated `0`, show an explicit em-dash and point at the pledges
            page, which does load real rows. */}
        <Stat
          label="Pledges this month"
          tone="muted"
          value={
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">Not available yet</span>
            </>
          }
          hint={
            <>
              Monthly totals aren&apos;t available yet.{" "}
              <Link
                href="/dashboard/institution/pledges"
                className="rounded font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                See every pledge
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
            New Need
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
            New Volunteer Event
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
                  New Need
                </span>
              }
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPanel(null)}
                  aria-label="Close the new need form"
                  icon={<X className="h-4 w-4" aria-hidden="true" />}
                >
                  Close
                </Button>
              }
            />
            <form onSubmit={submitNeed} className="space-y-4">
              <FormError message={needError} />
              <Field label="Title" required requiredLabel="required">
                {(field) => (
                  <Input
                    {...field}
                    required
                    value={needTitle}
                    onChange={(e) => setNeedTitle(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Description" hint="Optional">
                {(field) => (
                  <Textarea
                    {...field}
                    rows={3}
                    value={needDescription}
                    onChange={(e) => setNeedDescription(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Donation type">
                {(field) => (
                  <Select
                    {...field}
                    value={needDonationType}
                    onChange={(e) => setNeedDonationType(e.target.value as DonationType)}
                  >
                    {donationEntries.map(([key, { label }]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink">Urgency</legend>
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
              <Field label="Quantity needed" required requiredLabel="required">
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
                {needSubmitting ? "Posting…" : "Post Need"}
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
                  New Volunteer Event
                </span>
              }
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPanel(null)}
                  aria-label="Close the new volunteer event form"
                  icon={<X className="h-4 w-4" aria-hidden="true" />}
                >
                  Close
                </Button>
              }
            />
            <form onSubmit={submitEvent} className="space-y-4">
              <FormError message={evError} />
              <Field label="Title" required requiredLabel="required">
                {(field) => (
                  <Input
                    {...field}
                    required
                    value={evTitle}
                    onChange={(e) => setEvTitle(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Description" hint="Optional">
                {(field) => (
                  <Textarea
                    {...field}
                    rows={3}
                    value={evDescription}
                    onChange={(e) => setEvDescription(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Date" required requiredLabel="required">
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
                <Field label="Start">
                  {(field) => (
                    <Input
                      {...field}
                      type="time"
                      value={evStart}
                      onChange={(e) => setEvStart(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="End">
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
              <Field label="Volunteers needed" required requiredLabel="required">
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
                {evSubmitting ? "Posting…" : "Post Event"}
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
            View Map
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
