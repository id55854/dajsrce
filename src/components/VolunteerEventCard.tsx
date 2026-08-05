"use client";

import { useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { enUS, hr } from "date-fns/locale";
import { CheckCircle2 } from "lucide-react";
import type { InstitutionCategory, VolunteerEvent } from "@/lib/types";
import clsx from "clsx";
import { CATEGORY_CONFIG, categoryVars } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { AuthActionDialog } from "@/components/AuthActionDialog";
import { useLocale, useT } from "@/i18n/client";
import { Badge, Button, Card, buttonClasses } from "@/components/ui";

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
  /**
   * Called after a successful sign-up (or after the API reports 409 duplicate).
   * The parent should bump volunteers_signed_up locally and add the event id
   * to its registered set so the UI updates without a page refresh.
   */
  onSignUp?: (eventId: string) => void;
  /** When true, hides API sign-up; use `readOnlyHref` for a CTA link (e.g. pitch pages). */
  readOnly?: boolean;
  /** Label when `readOnly` is true (plain text or link label). */
  readOnlyLabel?: string;
  /** When set with `readOnly`, renders a primary red link instead of a muted note. */
  readOnlyHref?: string;
  /** Optional id passed through to the article element so the calendar can scroll to it. */
  htmlId?: string;
};

export function VolunteerEventCard({
  event,
  isRegistered = false,
  onSignUp,
  readOnly,
  readOnlyLabel,
  readOnlyHref,
  htmlId,
}: VolunteerEventCardProps) {
  const t = useT();
  const { locale } = useLocale();
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);

  const institution = event.institution;
  const categoryKey = institution?.category as InstitutionCategory | undefined;
  const cat = categoryKey && categoryKey in CATEGORY_CONFIG
    ? CATEGORY_CONFIG[categoryKey]
    : null;

  const dateLabel = format(parseISO(event.event_date), "PPPP", {
    locale: locale === "hr" ? hr : enUS,
  });

  const needed = event.volunteers_needed;
  const signed = event.volunteers_signed_up;
  const pct = needed > 0 ? Math.min(100, Math.round((signed / needed) * 100)) : 0;

  async function handleSignUp() {
    if (readOnly) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setAuthDialogOpen(true);
      return;
    }

    setLoading(true);
    setErrorState(false);
    try {
      const res = await fetch("/api/volunteer-signups", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: event.id }),
      });
      if (res.status === 409) {
        // Already registered (state had drifted out of sync). Reflect reality.
        onSignUp?.(event.id);
        return;
      }
      if (!res.ok) throw new Error();
      onSignUp?.(event.id);
    } catch {
      setErrorState(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      id={htmlId}
      as="article"
      tabIndex={-1}
      className={clsx(
        // The transition is what makes the calendar's "here it is" highlight
        // ring fade in and out instead of blinking on for 1.5s.
        "flex h-full min-h-0 flex-col outline-none transition-[box-shadow,border-color] duration-300 ease-out",
        isRegistered && "border-success ring-1 ring-success/30"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {institution ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {/* The id was already in props; the name used to be a dead <span>. */}
            <Link
              href={`/institution/${institution.id}`}
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

        {/* Same heading level as NeedCard: both are one browsable object. */}
        <h2 className="line-clamp-2 text-lg font-semibold leading-snug text-ink">
          {event.title}
        </h2>

        <p className="mt-2 text-sm text-ink-secondary">{dateLabel}</p>
        <p className="mt-1 text-base text-ink">
          {event.start_time} – {event.end_time}
        </p>

        {event.requirements ? (
          <p className="mt-3 text-sm text-ink-secondary">{event.requirements}</p>
        ) : null}
      </div>

      <div className="mt-auto w-full shrink-0 pt-4">
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

        <div className="pt-5">
          {readOnly ? (
            readOnlyHref ? (
              <Link
                href={readOnlyHref}
                className={buttonClasses({ fullWidth: true })}
              >
                {readOnlyLabel ?? t("volunteer_card.sign_in")}
              </Link>
            ) : (
              <p className="rounded-full bg-surface-sunken px-5 py-2.5 text-center text-sm font-medium text-ink-secondary">
                {readOnlyLabel ?? t("volunteer_card.sign_in_continue")}
              </p>
            )
          ) : isRegistered ? (
            <p className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-success-soft px-5 py-2.5 text-center text-sm font-semibold text-success-on-soft">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {t("volunteer_card.registered")}
            </p>
          ) : (
            <>
              <Button onClick={handleSignUp} loading={loading} fullWidth>
                {loading
                  ? t("volunteer_card.signing_up")
                  : t("volunteer_card.sign_up")}
              </Button>
              {errorState ? (
                <p className="mt-2 text-center text-sm text-danger" role="alert">
                  {t("volunteer_card.failed")}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
      {readOnly ? null : (
        <AuthActionDialog
          open={authDialogOpen}
          onClose={() => setAuthDialogOpen(false)}
          actionLabel={t("volunteer_card.auth_action")}
          nextPath="/volunteer"
        />
      )}
    </Card>
  );
}
