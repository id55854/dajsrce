"use client";

import { useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { InstitutionCategory, VolunteerEvent } from "@/lib/types";
import clsx from "clsx";
import { CATEGORY_CONFIG } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { AuthActionDialog } from "@/components/AuthActionDialog";

function clsxRing(isRegistered: boolean): string {
  return clsx(
    "flex h-full min-h-0 flex-col rounded-xl border bg-white p-5 shadow-sm transition-shadow dark:bg-gray-900",
    isRegistered
      ? "border-emerald-300 ring-2 ring-emerald-200/70 dark:border-emerald-800 dark:ring-emerald-900/40"
      : "border-gray-100 dark:border-gray-800"
  );
}

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
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);

  const institution = event.institution;
  const categoryKey = institution?.category as InstitutionCategory | undefined;
  const cat = categoryKey && categoryKey in CATEGORY_CONFIG
    ? CATEGORY_CONFIG[categoryKey]
    : null;

  const dateLabel = format(parseISO(event.event_date), "EEEE, MMMM d, yyyy");

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
    <article
      id={htmlId}
      className={clsxRing(isRegistered)}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {institution ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {institution.name}
            </span>
            {cat ? (
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                style={{ color: cat.color, backgroundColor: cat.bgColor }}
              >
                {cat.label}
              </span>
            ) : (
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {institution.category}
              </span>
            )}
          </div>
        ) : null}

        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {event.title}
        </h3>

        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{dateLabel}</p>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
          {event.start_time} – {event.end_time}
        </p>

        {event.requirements ? (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            {event.requirements}
          </p>
        ) : null}
      </div>

      <div className="mt-auto w-full shrink-0">
        <div>
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Volunteers</span>
            <span>{signed} / {needed}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              className="h-full rounded-full bg-red-500 transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="pt-5">
          {readOnly ? (
            readOnlyHref ? (
              <Link
                href={readOnlyHref}
                className="flex w-full justify-center rounded-full bg-red-500 px-5 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-600"
              >
                {readOnlyLabel ?? "Sign in"}
              </Link>
            ) : (
              <p className="rounded-full bg-gray-100 px-5 py-2.5 text-center text-sm font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {readOnlyLabel ?? "Sign in to continue"}
              </p>
            )
          ) : isRegistered ? (
            <p className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-50 px-5 py-2.5 text-center text-sm font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              You&rsquo;re registered
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSignUp}
                disabled={loading}
                className="w-full rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-600 disabled:opacity-60"
              >
                {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Sign Up"}
              </button>
              {errorState ? (
                <p className="mt-2 text-center text-xs text-red-600">
                  Sign-up failed. Please try again.
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
          actionLabel="Volunteer"
          nextPath="/volunteer"
        />
      )}
    </article>
  );
}
