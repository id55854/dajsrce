"use client";

import { format, parseISO } from "date-fns";
import { hr } from "date-fns/locale/hr";
import type { InstitutionCategory, VolunteerEvent } from "@/lib/types";
import { CATEGORY_CONFIG } from "@/lib/constants";

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
};

export function VolunteerEventCard({ event }: VolunteerEventCardProps) {
  const institution = event.institution;
  const categoryKey = institution?.category as InstitutionCategory | undefined;
  const cat = categoryKey && categoryKey in CATEGORY_CONFIG
    ? CATEGORY_CONFIG[categoryKey]
    : null;

  const dateLabel = format(parseISO(event.event_date), "EEEE, d. MMMM yyyy.", {
    locale: hr,
  });

  const needed = event.volunteers_needed;
  const signed = event.volunteers_signed_up;
  const pct =
    needed > 0 ? Math.min(100, Math.round((signed / needed) * 100)) : 0;

  return (
    <article className="flex flex-col rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      {institution ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-[family-name:var(--font-dm-sans)] text-sm font-semibold text-gray-900">
            {institution.name}
          </span>
          {cat ? (
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ color: cat.color, backgroundColor: cat.bgColor }}
            >
              {cat.labelHr}
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {institution.category}
            </span>
          )}
        </div>
      ) : null}

      <h3 className="font-[family-name:var(--font-dm-sans)] text-lg font-semibold text-gray-900">
        {event.title}
      </h3>

      <p className="mt-2 text-sm text-gray-600">{dateLabel}</p>
      <p className="mt-1 text-sm text-gray-700">
        {event.start_time} – {event.end_time}
      </p>

      <div className="mt-4">
        <div className="flex justify-between text-xs text-gray-500">
          <span>Volonteri</span>
          <span>
            {event.volunteers_signed_up} / {event.volunteers_needed}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-red-500 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {event.requirements ? (
        <p className="mt-3 text-sm text-gray-500">{event.requirements}</p>
      ) : null}

      <button
        type="button"
        className="mt-5 w-full rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-600"
      >
        Prijavi se
      </button>
    </article>
  );
}
