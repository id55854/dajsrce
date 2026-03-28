"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Building2,
  CalendarPlus,
  ClipboardList,
  MapPin,
  Plus,
} from "lucide-react";
import { DONATION_TYPES } from "@/lib/constants";
import type { DonationType, UrgencyLevel } from "@/lib/types";

const donationEntries = Object.entries(DONATION_TYPES) as [
  DonationType,
  { labelHr: string },
][];

const urgencyOptions: { value: UrgencyLevel; label: string }[] = [
  { value: "routine", label: "Standardno" },
  { value: "needed_soon", label: "Potrebno uskoro" },
  { value: "urgent", label: "Hitno" },
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

  const [evTitle, setEvTitle] = useState("");
  const [evDescription, setEvDescription] = useState("");
  const [evDate, setEvDate] = useState("");
  const [evStart, setEvStart] = useState("09:00");
  const [evEnd, setEvEnd] = useState("12:00");
  const [evVolunteers, setEvVolunteers] = useState("5");
  const [evSuccess, setEvSuccess] = useState(false);

  function submitNeed(e: React.FormEvent) {
    e.preventDefault();
    setNeedSuccess(true);
    setNeedTitle("");
    setNeedDescription("");
    setNeedQuantity("1");
    setTimeout(() => {
      setNeedSuccess(false);
      setPanel(null);
    }, 2000);
  }

  function submitEvent(e: React.FormEvent) {
    e.preventDefault();
    setEvSuccess(true);
    setEvTitle("");
    setEvDescription("");
    setEvDate("");
    setEvVolunteers("5");
    setTimeout(() => {
      setEvSuccess(false);
      setPanel(null);
    }, 2000);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50/60 to-white px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <h1 className="text-2xl font-bold text-gray-900">
            Upravljanje ustanovom
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Potrebe, događaji i pregled aktivnosti.
          </p>
        </header>

        <section className="rounded-2xl border border-red-100 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-500">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-gray-900">Profil ustanove</h2>
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Povežite Supabase za potpuno upravljanje ustanovom.
                U demo načinu možete pregledati obrasce.
              </p>
            </div>
          </div>
        </section>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold text-gray-500">
            Obećanja ovaj mjesec
          </h3>
          <p className="text-3xl font-bold text-red-500">0</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => {
              setNeedSuccess(false);
              setPanel("need");
            }}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-red-500/20 transition-colors hover:bg-red-600"
          >
            <Plus className="h-5 w-5" />
            Nova potreba
          </button>
          <button
            type="button"
            onClick={() => {
              setEvSuccess(false);
              setPanel("event");
            }}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-red-200 bg-white px-4 py-3.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
          >
            <CalendarPlus className="h-5 w-5" />
            Novi volonterski događaj
          </button>
        </div>

        {panel === "need" ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                <ClipboardList className="h-5 w-5 text-red-500" />
                Nova potreba
              </h3>
              <button
                type="button"
                onClick={() => setPanel(null)}
                className="text-sm font-medium text-gray-500 hover:text-gray-800"
              >
                Zatvori
              </button>
            </div>
            {needSuccess ? (
              <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                Potreba objavljena! (demo)
              </p>
            ) : (
              <form onSubmit={submitNeed} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Naslov
                  </label>
                  <input
                    required
                    value={needTitle}
                    onChange={(e) => setNeedTitle(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Opis
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={needDescription}
                    onChange={(e) => setNeedDescription(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none ring-red-500/20 focus:border-red-400 focus:ring-4"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Vrsta donacije
                  </label>
                  <select
                    value={needDonationType}
                    onChange={(e) =>
                      setNeedDonationType(e.target.value as DonationType)
                    }
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20"
                  >
                    {donationEntries.map(([key, { labelHr }]) => (
                      <option key={key} value={key}>
                        {labelHr}
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-gray-700">
                    Hitnost
                  </legend>
                  <div className="flex flex-wrap gap-3">
                    {urgencyOptions.map((o) => (
                      <label
                        key={o.value}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 has-[:checked]:border-red-400 has-[:checked]:bg-red-50"
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
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Potrebna količina
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={needQuantity}
                    onChange={(e) => setNeedQuantity(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-red-500 py-3 text-sm font-semibold text-white hover:bg-red-600"
                >
                  Objavi potrebu
                </button>
              </form>
            )}
          </div>
        ) : null}

        {panel === "event" ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                <CalendarPlus className="h-5 w-5 text-red-500" />
                Novi volonterski događaj
              </h3>
              <button
                type="button"
                onClick={() => setPanel(null)}
                className="text-sm font-medium text-gray-500 hover:text-gray-800"
              >
                Zatvori
              </button>
            </div>
            {evSuccess ? (
              <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                Događaj objavljen! (demo)
              </p>
            ) : (
              <form onSubmit={submitEvent} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Naslov
                  </label>
                  <input
                    required
                    value={evTitle}
                    onChange={(e) => setEvTitle(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Opis
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={evDescription}
                    onChange={(e) => setEvDescription(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Datum
                  </label>
                  <input
                    type="date"
                    required
                    value={evDate}
                    onChange={(e) => setEvDate(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Početak
                    </label>
                    <input
                      type="time"
                      value={evStart}
                      onChange={(e) => setEvStart(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Kraj
                    </label>
                    <input
                      type="time"
                      value={evEnd}
                      onChange={(e) => setEvEnd(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Potreban broj volontera
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={evVolunteers}
                    onChange={(e) => setEvVolunteers(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-500/20"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-red-500 py-3 text-sm font-semibold text-white hover:bg-red-600"
                >
                  Objavi događaj
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
            Pregled karte
          </Link>
        </div>
      </div>
    </div>
  );
}
