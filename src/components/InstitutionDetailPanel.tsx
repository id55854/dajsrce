"use client";

import type { ReactNode } from "react";
import type { Institution } from "@/lib/types";
import { CATEGORY_CONFIG, DONATION_TYPES } from "@/lib/constants";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Package,
  Phone,
  Train,
  Users,
  X,
} from "lucide-react";

export interface InstitutionDetailPanelProps {
  institution: Institution;
  onClose?: () => void;
  /** When false, hides the close control (e.g. standalone public page). */
  showCloseButton?: boolean;
}

function normalizeWebsiteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

export function InstitutionDetailPanel({
  institution,
  onClose,
  showCloseButton = true,
}: InstitutionDetailPanelProps) {
  const cat = CATEGORY_CONFIG[institution.category];
  const addressDisplay = institution.is_location_hidden
    ? `Location hidden for safety — ${institution.approximate_area ?? "—"}`
    : `${institution.address}, ${institution.city}`;

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${institution.lat},${institution.lng}`;
  const telHref = institution.phone
    ? `tel:${institution.phone.replace(/\s/g, "")}`
    : null;

  return (
    <div className="relative rounded-xl border border-gray-100 bg-white shadow-lg">
      {showCloseButton ? (
        <button
          type="button"
          onClick={() => onClose?.()}
          className="absolute right-3 top-3 z-10 rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      ) : null}

      <div>
        {institution.is_location_hidden ? (
          <div className="border-b border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            The exact location of this institution is hidden for the safety of
            residents. Please contact them by phone.
          </div>
        ) : null}

        <div
          className={
            showCloseButton
              ? "space-y-5 p-4 pr-12 sm:p-5 sm:pr-14"
              : "space-y-5 p-4 sm:p-5"
          }
        >
          <header className="space-y-3">
            <span
              className="inline-flex rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                color: cat.color,
                backgroundColor: cat.bgColor,
              }}
            >
              {cat.label}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-[family-name:var(--font-dm-sans)] text-2xl font-bold text-gray-900">
                {institution.name}
              </h2>
              {institution.is_verified ? (
                <CheckCircle2
                  className="h-6 w-6 shrink-0 text-emerald-500"
                  aria-label="Verified institution"
                />
              ) : null}
            </div>
          </header>

          <p className="text-gray-700">{institution.description}</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InfoItem
              icon={MapPin}
              label="Address"
              value={addressDisplay}
            />
            <InfoItem
              icon={Phone}
              label="Phone"
              value={
                institution.phone ? (
                  <a
                    href={telHref!}
                    className="text-red-500 underline-offset-2 hover:underline"
                  >
                    {institution.phone}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem
              icon={Mail}
              label="Email"
              value={
                institution.email ? (
                  <a
                    href={`mailto:${institution.email}`}
                    className="text-red-500 underline-offset-2 hover:underline"
                  >
                    {institution.email}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem
              icon={Globe}
              label="Website"
              value={
                institution.website ? (
                  <a
                    href={normalizeWebsiteUrl(institution.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-500 underline-offset-2 hover:underline"
                  >
                    {institution.website}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem
              icon={Clock}
              label="Working hours"
              value={institution.working_hours ?? "—"}
            />
            <InfoItem
              icon={Package}
              label="Drop-off hours"
              value={institution.drop_off_hours ?? "—"}
            />
          </div>

          <section>
            <h3 className="mb-2 font-[family-name:var(--font-dm-sans)] text-sm font-semibold text-gray-900">
              Accepts
            </h3>
            <DonationBadges accepts={institution.accepts_donations} />
          </section>

          {institution.capacity ? (
            <div className="flex items-start gap-3 rounded-xl bg-gray-50 p-3">
              <Users className="mt-0.5 h-5 w-5 shrink-0 text-gray-500" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Capacity
                </p>
                <p className="text-sm text-gray-800">{institution.capacity}</p>
              </div>
            </div>
          ) : null}

          {institution.nearest_zet_stop ? (
            <section className="rounded-xl border border-gray-100 bg-gray-50/80 p-4">
              <h3 className="mb-2 flex items-center gap-2 font-[family-name:var(--font-dm-sans)] text-sm font-semibold text-gray-900">
                <Train className="h-4 w-4 text-gray-600" />
                Nearby ZET stop
              </h3>
              <p className="text-sm text-gray-800">
                {institution.nearest_zet_stop}
              </p>
              {institution.zet_lines ? (
                <p className="mt-1 text-sm text-gray-600">
                  Lines: {institution.zet_lines}
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="flex flex-wrap gap-3 pt-1">
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 min-w-[10rem] items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Google Maps
            </a>
            {institution.phone ? (
              <a
                href={telHref!}
                className="inline-flex flex-1 min-w-[10rem] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
              >
                <Phone className="h-4 w-4" />
                Call
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {label}
        </p>
        <div className="break-words text-sm text-gray-800">{value}</div>
      </div>
    </div>
  );
}

function DonationBadges({
  accepts,
}: {
  accepts: Institution["accepts_donations"];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {accepts.map((type) => (
        <span
          key={type}
          className="rounded-full border border-red-100 bg-red-50 px-3 py-1 text-xs font-medium text-red-700"
        >
          {DONATION_TYPES[type].label}
        </span>
      ))}
    </div>
  );
}
