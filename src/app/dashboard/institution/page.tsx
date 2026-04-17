"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Building2,
  CalendarPlus,
  ClipboardList,
  MapPin,
  Plus,
  Inbox,
} from "lucide-react";
import { DONATION_TYPES } from "@/lib/constants";
import type { DonationType, UrgencyLevel } from "@/lib/types";

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
  const [panel, setPanel] = useState<"need" | "event" | null>(null);

  const [needTitle, setNeedTitle] = useState("");
  const [needDescription, setNeedDescription] = useState("");
  const [needDonationType, setNeedDonationType] =
    useState<DonationType>("food");
  const [needUrgency, setNeedUrgency] = useState<UrgencyLevel>("routine");
  const [needQuantity, setNeedQuantity] = useState("1");
  const [needSuccess, setNeedSuccess] = useState(false);
  const [needSubmitting, setNeedSubmitting] = useState(false);
  const [needError, setNeedError] = useState<string | null>(null);

  const [evTitle, setEvTitle] = useState("");
  const [evDescription, setEvDescription] = useState("");
  const [evDate, setEvDate] = useState("");
  const [evStart, setEvStart] = useState("09:00");
  const [evEnd, setEvEnd] = useState("12:00");
  const [evVolunteers, setEvVolunteers] = useState("5");
  const [evSuccess, setEvSuccess] = useState(false);
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
      setNeedSuccess(true);
      setNeedTitle("");
      setNeedDescription("");
      setNeedQuantity("1");
      setTimeout(() => {
        setNeedSuccess(false);
        setPanel(null);
      }, 2000);
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
      setEvSuccess(true);
      setEvTitle("");
      setEvDescription("");
      setEvDate("");
      setEvVolunteers("5");
      setTimeout(() => {
        setEvSuccess(false);
        setPanel(null);
      }, 2000);
    } catch (err) {
      setEvError(err instanceof Error ? err.message : "Failed to post event");
    } finally {
      setEvSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50/60 to-white px-4 py-10 dark:from-gray-950 dark:to-gray-950">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Institution Management
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Manage needs, events, and activities.
            </p>
          </div>
          <Link
            href="/dashboard/institution/pledges"
            className="inline-flex items-center gap-2 rounded-full border-2 border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm hover:bg-red-50 dark:border-red-900 dark:bg-gray-900 dark:hover:bg-red-950/40"
          >
            <Inbox className="h-4 w-4" aria-hidden />
            Pledges
          </Link>
        </header>

        <section className="rounded-2xl border border-red-100 bg-white p-6 shadow-sm dark:border-red-900 dark:bg-gray-900">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-500">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Institution Profile
              </h2>
            </div>
          </div>
        </section>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h3 className="mb-1 text-sm font-semibold text-gray-500">
            Pledges this month
          </h3>
          <p className="text-3xl font-bold text-red-500">0</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => {
              setNeedSuccess(false);
              setNeedError(null);
              setPanel("need");
            }}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-red-500/20 transition-colors hover:bg-red-600"
          >
            <Plus className="h-5 w-5" />
            New Need
          </button>
          <button
            type="button"
            onClick={() => {
              setEvSuccess(false);
              setEvError(null);
              setPanel("event");
            }}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-red-200 bg-white px-4 py-3.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:bg-gray-900 dark:hover:bg-red-950"
          >
            <CalendarPlus className="h-5 w-5" />
            New Volunteer Event
          </button>
        </div>

        {panel === "need" ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                <ClipboardList className="h-5 w-5 text-red-500" />
                New Need
              </h3>
              <button
                type="button"
                onClick={() => setPanel(null)}
                className="text-sm font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Close
              </button>
            </div>
            {needSuccess ? (
              <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                Need posted!
              </p>
            ) : (
              <form onSubmit={submitNeed} className="space-y-4">
                {needError ? (
                  <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                    {needError}
                  </p>
                ) : null}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Title
                  </label>
                  <input
                    required
                    value={needTitle}
                    onChange={(e) => setNeedTitle(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Description
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={needDescription}
                    onChange={(e) => setNeedDescription(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Donation type
                  </label>
                  <select
                    value={needDonationType}
                    onChange={(e) =>
                      setNeedDonationType(e.target.value as DonationType)
                    }
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  >
                    {donationEntries.map(([key, { label }]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                    Urgency
                  </legend>
                  <div className="flex flex-wrap gap-3">
                    {urgencyOptions.map((o) => (
                      <label
                        key={o.value}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 has-[:checked]:border-red-400 has-[:checked]:bg-red-50 dark:border-gray-700 dark:has-[:checked]:bg-red-950"
                      >
                        <input
                          type="radio"
                          name="urgency"
                          value={o.value}
                          checked={needUrgency === o.value}
                          onChange={() => setNeedUrgency(o.value)}
                          className="text-red-500"
                        />
                        <span className="text-sm">{o.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Quantity needed
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={needQuantity}
                    onChange={(e) => setNeedQuantity(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <button
                  type="submit"
                  disabled={needSubmitting}
                  className="w-full rounded-xl bg-red-500 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                >
                  {needSubmitting ? "Posting…" : "Post Need"}
                </button>
              </form>
            )}
          </div>
        ) : null}

        {panel === "event" ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                <CalendarPlus className="h-5 w-5 text-red-500" />
                New Volunteer Event
              </h3>
              <button
                type="button"
                onClick={() => setPanel(null)}
                className="text-sm font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Close
              </button>
            </div>
            {evSuccess ? (
              <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                Event posted!
              </p>
            ) : (
              <form onSubmit={submitEvent} className="space-y-4">
                {evError ? (
                  <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                    {evError}
                  </p>
                ) : null}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Title
                  </label>
                  <input
                    required
                    value={evTitle}
                    onChange={(e) => setEvTitle(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Description
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={evDescription}
                    onChange={(e) => setEvDescription(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={evDate}
                    onChange={(e) => setEvDate(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Start
                    </label>
                    <input
                      type="time"
                      value={evStart}
                      onChange={(e) => setEvStart(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      End
                    </label>
                    <input
                      type="time"
                      value={evEnd}
                      onChange={(e) => setEvEnd(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Volunteers needed
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={evVolunteers}
                    onChange={(e) => setEvVolunteers(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <button
                  type="submit"
                  disabled={evSubmitting}
                  className="w-full rounded-xl bg-red-500 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                >
                  {evSubmitting ? "Posting…" : "Post Event"}
                </button>
              </form>
            )}
          </div>
        ) : null}

        <div className="pb-8">
          <Link
            href="/map"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 py-4 text-sm font-semibold text-white shadow-md shadow-red-500/25 transition-colors hover:bg-red-600 sm:w-auto sm:px-10"
          >
            <MapPin className="h-5 w-5" />
            View Map
          </Link>
        </div>
      </div>
    </div>
  );
}
