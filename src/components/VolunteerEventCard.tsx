"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";
import type { InstitutionCategory, VolunteerEvent } from "@/lib/types";
import { CATEGORY_CONFIG } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { AuthActionDialog } from "@/components/AuthActionDialog";

export type VolunteerEventCardProps = {
  event: VolunteerEvent & {
    institution?: {
      id: string;
      name: string;
      category: string;
      address: string;
      city: string;
    };
  };
  onSignUp?: () => void;
};

export function VolunteerEventCard({ event, onSignUp }: VolunteerEventCardProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error" | "duplicate">("idle");
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
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setAuthDialogOpen(true);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/volunteer-signups", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: event.id }),
      });
      if (res.status === 409) {
        setStatus("duplicate");
        return;
      }
      if (!res.ok) throw new Error();
      setStatus("success");
      onSignUp?.();
    } catch {
      setStatus("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="flex flex-col rounded-xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
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

      <div className="mt-4">
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

      {event.requirements ? (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          {event.requirements}
        </p>
      ) : null}

      {status === "success" ? (
        <p className="mt-5 rounded-full bg-emerald-50 px-5 py-2.5 text-center text-sm font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
          Signed up!
        </p>
      ) : status === "duplicate" ? (
        <p className="mt-5 rounded-full bg-amber-50 px-5 py-2.5 text-center text-sm font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400">
          Already signed up
        </p>
      ) : (
        <button
          type="button"
          onClick={handleSignUp}
          disabled={loading}
          className="mt-5 w-full rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-600 disabled:opacity-60"
        >
          {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Sign Up"}
        </button>
      )}
      <AuthActionDialog
        open={authDialogOpen}
        onClose={() => setAuthDialogOpen(false)}
        actionLabel="Volunteer"
        nextPath="/volunteer"
      />
    </article>
  );
}
