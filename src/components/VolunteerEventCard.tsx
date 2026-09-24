"use client";

import { useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { enUS, hr } from "date-fns/locale";
import { Building2, CalendarDays, CheckCircle2, MapPin, Phone } from "lucide-react";
import type { InstitutionCategory, VolunteerEvent } from "@/lib/types";
import clsx from "clsx";
import { CATEGORY_CONFIG, categoryVars } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { AuthActionDialog } from "@/components/AuthActionDialog";
import { useLocale, useT } from "@/i18n/client";
import { Badge, Button, Card, Dialog, buttonClasses } from "@/components/ui";
import { useLiveCapacity } from "@/lib/live-capacity";
import { CancelActionButton } from "@/components/YourPledgesSection";
import type { CapacityErrorCode } from "@/lib/capacity-errors";

export type VolunteerEventCardProps = {
  event: Omit<VolunteerEvent, "institution"> & {
    institution?: {
      id: string;
      name: string;
      category: string;
      address: string;
      city: string;
    };
  };
  /**
   * Source-of-truth flag from the page: caller has already confirmed this
   * user is signed up. Renders the "Already registered" banner unconditionally.
   */
  isRegistered?: boolean;
  /** Show the event while its private signup state is still being resolved. */
  registrationPending?: boolean;
  /**
   * Called after a successful sign-up (or after the API reports 409 duplicate).
   * The parent should bump volunteers_signed_up locally and add the event id
   * to its registered set so the UI updates without a page refresh.
   */
  onSignUp?: (eventId: string, signupId?: string) => void;
  /**
   * The visitor's own signup for this event, when the parent knows it. With
   * `onCancelled` it adds a withdraw control under "You're registered".
   */
  signupId?: string | null;
  onCancelled?: (eventId: string) => void;
  /** When true, hides API sign-up; use `readOnlyHref` for a CTA link (e.g. pitch pages). */
  readOnly?: boolean;
  /** Label when `readOnly` is true (plain text or link label). */
  readOnlyLabel?: string;
  /** When set with `readOnly`, renders a primary red link instead of a muted note. */
  readOnlyHref?: string;
  /** Optional id passed through to the article element so the calendar can scroll to it. */
  htmlId?: string;
  /**
   * Leave the organisation out of the card's own header, where the page
   * around it already names it (the map's organisation panel). The details
   * dialog still says who posted the event and where.
   */
  hideInstitutionHeader?: boolean;
};

export function VolunteerEventCard({
  event,
  isRegistered = false,
  registrationPending = false,
  onSignUp,
  readOnly,
  readOnlyLabel,
  readOnlyHref,
  htmlId,
  hideInstitutionHeader = false,
  signupId = null,
  onCancelled,
}: VolunteerEventCardProps) {
  const t = useT();
  const { locale } = useLocale();
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const institution = event.institution;
  const categoryKey = institution?.category as InstitutionCategory | undefined;
  const cat = categoryKey && categoryKey in CATEGORY_CONFIG
    ? CATEGORY_CONFIG[categoryKey]
    : null;

  const dateLabel = format(parseISO(event.event_date), "PPPP", {
    locale: locale === "hr" ? hr : enUS,
  });

  // Counts follow other people's signups and withdrawals live; see
  // useLiveCapacity. The signup RPC still decides, under a row lock.
  const [counts, applyCounts] = useLiveCapacity("volunteer_events", event.id, {
    volunteers_needed: event.volunteers_needed,
    volunteers_signed_up: event.volunteers_signed_up,
  });
  const needed = counts.volunteers_needed;
  const signed = counts.volunteers_signed_up;
  const pct = needed > 0 ? Math.min(100, Math.round((signed / needed) * 100)) : 0;
  // Someone already registered keeps their confirmation; a full event only
  // closes the door for everyone else.
  const full = !isRegistered && needed > 0 && signed >= needed;

  async function handleSignUp() {
    if (readOnly) return;
    const supabase = createClient();
    // UI gating only; the signup API re-verifies the token server-side.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) {
      setDetailsOpen(false);
      setAuthDialogOpen(true);
      return;
    }

    setLoading(true);
    setErrorKey(null);
    try {
      const res = await fetch("/api/volunteer-signups", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: event.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: CapacityErrorCode } | null;
        if (body?.code === "already_signed_up") {
          // State had drifted out of sync. Reflect reality.
          onSignUp?.(event.id);
          return;
        }
        if (body?.code === "event_full") {
          // The last place went while this page was open.
          applyCounts({ volunteers_signed_up: Math.max(signed, needed) });
          setErrorKey("volunteer_card.full_now");
          return;
        }
        setErrorKey(body?.code === "event_ended" ? "volunteer_card.ended" : "volunteer_card.failed");
        return;
      }
      const created = (await res.json().catch(() => null)) as { signup?: { id?: string } } | null;
      onSignUp?.(event.id, created?.signup?.id);
    } catch {
      setErrorKey("volunteer_card.failed");
    } finally {
      setLoading(false);
    }
  }

  const timeLabel = `${event.start_time.slice(0, 5)} – ${event.end_time.slice(0, 5)}`;
  // The event's own place when the organisation gave one, else its address.
  const place =
    event.location?.trim() ||
    [institution?.address, institution?.city].filter(Boolean).join(", ");

  const progress = (
    <div>
      <div className="flex justify-between text-sm text-ink-tertiary">
        <span>{t("volunteer_card.volunteers")}</span>
        <span className="tabular-nums">{signed} / {needed}</span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t("volunteer_card.progress", { signed, needed })}
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );

  // One action for the card and the details dialog, so both always agree on
  // whether this visitor can still sign up.
  const action = readOnly ? (
    readOnlyHref ? (
      <Link href={readOnlyHref} className={buttonClasses({ fullWidth: true })}>
        {readOnlyLabel ?? t("volunteer_card.sign_in")}
      </Link>
    ) : (
      <p className="rounded-full bg-surface-sunken px-5 py-2.5 text-center text-sm font-medium text-ink-secondary">
        {readOnlyLabel ?? t("volunteer_card.sign_in_continue")}
      </p>
    )
  ) : isRegistered ? (
    <div className="w-full space-y-2">
      <p className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-success-soft px-5 py-2.5 text-center text-sm font-semibold text-success-on-soft">
        <CheckCircle2 className="h-4 w-4" aria-hidden />
        {t("volunteer_card.registered")}
      </p>
      {signupId && onCancelled ? (
        <div className="flex justify-center">
          <CancelActionButton
            endpoint={`/api/volunteer-signups/${signupId}`}
            label={t("volunteer_signup.cancel")}
            title={t("volunteer_signup.cancel_title")}
            description={t("volunteer_signup.cancel_body", { title: event.title })}
            confirmLabel={t("volunteer_signup.cancel_confirm")}
            successTitle={t("volunteer_signup.cancel_success")}
            errorTitle={t("volunteer_signup.cancel_error")}
            conflictDescription={t("volunteer_signup.cancel_error_locked")}
            onCancelled={() => {
              applyCounts({ volunteers_signed_up: Math.max(0, signed - 1) });
              setDetailsOpen(false);
              onCancelled(event.id);
            }}
          />
        </div>
      ) : null}
    </div>
  ) : (
    <div className="w-full">
      {full ? (
        <Button disabled fullWidth variant="secondary">
          {t("volunteer_card.full")}
        </Button>
      ) : (
        <Button onClick={handleSignUp} loading={loading || registrationPending} fullWidth>
          {loading ? t("volunteer_card.signing_up") : t("volunteer_card.sign_up")}
        </Button>
      )}
      {errorKey ? (
        <p className="mt-2 text-center text-sm text-danger" role="alert">
          {t(errorKey)}
        </p>
      ) : null}
    </div>
  );

  return (
    <>
      <Card
        id={htmlId}
        as="article"
        tabIndex={-1}
        onClick={() => setDetailsOpen(true)}
        className={clsx(
          // The transition is what makes the calendar's "here it is" highlight
          // ring fade in and out instead of blinking on for 1.5s. Hover grows
          // the card slightly so a pointer and a lift say the event opens.
          "relative flex h-full min-h-0 cursor-pointer flex-col outline-none",
          "transition-[box-shadow,border-color,opacity,filter,transform] duration-200 ease-out",
          "hover:z-10 hover:shadow-overlay motion-safe:hover:scale-[1.02] motion-safe:active:scale-[0.99]",
          isRegistered && "border-success ring-1 ring-success/30",
          full && "opacity-60 grayscale"
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {institution && !hideInstitutionHeader ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {/* The id was already in props; the name used to be a dead <span>. */}
              <Link
                href={`/institution/${institution.id}`}
                onClick={(click) => click.stopPropagation()}
                className="rounded-control text-sm font-semibold text-ink underline-offset-2 transition-colors hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                {institution.name}
              </Link>
              {cat && categoryKey ? (
                <span
                  style={categoryVars(categoryKey)}
                  className="category-chip inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold"
                >
                  {locale === "hr" ? cat.labelHr : cat.label}
                </span>
              ) : (
                <Badge>{institution.category}</Badge>
              )}
            </div>
          ) : null}

          {/* Same heading level as NeedCard: both are one browsable object.
              The title opens the event itself; the organisation link above
              is the only way to its profile. */}
          <h2 className="line-clamp-2 text-lg font-semibold leading-snug text-ink">
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              aria-haspopup="dialog"
              className="rounded-control text-left transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              {event.title}
            </button>
          </h2>

          <p className="mt-2 text-sm text-ink-secondary">{dateLabel}</p>
          <p className="mt-1 text-base text-ink">{timeLabel}</p>
          {event.location?.trim() ? (
            <p className="mt-1 inline-flex items-center gap-1 text-sm text-ink-secondary">
              <MapPin className="h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
              <span className="truncate">{event.location}</span>
            </p>
          ) : null}

          {event.description ? (
            <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm leading-6 text-ink-secondary">
              {event.description}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            aria-haspopup="dialog"
            className="mt-2 self-start rounded-control text-sm font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {t("volunteer_card.details")}
          </button>
        </div>

        <div className="mt-auto w-full shrink-0 pt-4" onClick={(click) => click.stopPropagation()}>
          {progress}
          <div className="pt-5">{action}</div>
        </div>
      </Card>

      <Dialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={event.title}
        description={institution?.name}
        closeLabel={t("common.close")}
        variant="sheet-on-mobile"
        footer={action}
      >
        <div className="space-y-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {institution ? (
              <div className="flex gap-2.5">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
                <div className="min-w-0">
                  <dt className="text-xs text-ink-tertiary">{t("volunteer_card.organiser")}</dt>
                  <dd>
                    <Link
                      href={`/institution/${institution.id}`}
                      className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline"
                    >
                      {institution.name}
                    </Link>
                  </dd>
                </div>
              </div>
            ) : null}
            <div className="flex gap-2.5">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
              <div>
                <dt className="text-xs text-ink-tertiary">{t("volunteer_card.when")}</dt>
                <dd className="text-ink">{dateLabel}</dd>
                <dd className="text-ink-secondary">{timeLabel}</dd>
              </div>
            </div>
            {place ? (
              <div className="flex gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
                <div>
                  <dt className="text-xs text-ink-tertiary">{t("volunteer_card.where")}</dt>
                  <dd className="text-ink">{place}</dd>
                </div>
              </div>
            ) : null}
            {event.contact_person || event.contact_phone ? (
              <div className="flex gap-2.5">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
                <div>
                  <dt className="text-xs text-ink-tertiary">{t("volunteer_card.contact")}</dt>
                  {event.contact_person ? <dd className="text-ink">{event.contact_person}</dd> : null}
                  {event.contact_phone ? (
                    <dd>
                      <a
                        href={`tel:${event.contact_phone.replace(/[^\d+]/g, "")}`}
                        className="text-brand underline-offset-2 hover:underline"
                      >
                        {event.contact_phone}
                      </a>
                    </dd>
                  ) : null}
                </div>
              </div>
            ) : null}
          </dl>

          {event.description ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                {t("volunteer_card.about")}
              </h3>
              <p className="mt-1.5 whitespace-pre-line text-base leading-7 text-ink">
                {event.description}
              </p>
            </section>
          ) : null}

          {event.requirements ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                {t("volunteer_card.requirements")}
              </h3>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-ink-secondary">
                {event.requirements}
              </p>
            </section>
          ) : null}

          {progress}

          {institution ? (
            <Link
              href={`/institution/${institution.id}`}
              className="inline-block text-sm font-semibold text-brand underline-offset-2 hover:underline"
            >
              {t("volunteer_card.view_organisation")}
            </Link>
          ) : null}
        </div>
      </Dialog>

      {readOnly ? null : (
        <AuthActionDialog
          open={authDialogOpen}
          onClose={() => setAuthDialogOpen(false)}
          actionLabel={t("volunteer_card.auth_action")}
          nextPath="/volunteer"
        />
      )}
    </>
  );
}
