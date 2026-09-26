"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { enUS, hr } from "date-fns/locale";
import {
  Building2,
  CalendarClock,
  CalendarDays,
  Clock,
  Globe,
  Mail,
  MapPin,
  PackageOpen,
  Phone,
} from "lucide-react";
import { useLocale, useT } from "@/i18n/client";
import { timeAgo } from "@/lib/utils";
import { normalizeWebsite } from "@/lib/institution-profile";
import { RosterFact, RosterSection } from "@/components/Roster";
import { Dialog } from "@/components/ui";

/**
 * The organisation's side of a pledge: who to contact and where things go.
 *
 * Read from the public projection only. `address` is `public_address`, which
 * for a hidden location is its coarse area, never the street; the rest are
 * the contact fields the organisation publishes on its own profile.
 */
export type PledgeHandoverInstitution = {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  is_location_hidden?: boolean | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  working_hours?: string | null;
  drop_off_hours?: string | null;
};

/**
 * What the pledge details dialog reads. Both the profile's donation history
 * and the "your pledges" summary on /doniraj pass rows from GET /api/pledges,
 * so one dialog serves both and they cannot drift apart.
 */
export type PledgeDetails = {
  quantity: number;
  created_at: string;
  message?: string | null;
  need?: {
    title: string;
    description?: string | null;
    deadline?: string | null;
    quantity_needed?: number | null;
    quantity_pledged?: number | null;
    institution?: PledgeHandoverInstitution | null;
  } | null;
};

function websiteLabel(href: string): string {
  try {
    const url = new URL(href);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return href;
  }
}

/**
 * "What now?" after a promise: the next step in plain words, then every way
 * the organisation has published to reach it. Shown the moment a pledge is
 * made and again whenever the donor reopens it, so the handover never depends
 * on having noted the details down.
 */
export function PledgeHandover({ institution }: { institution?: PledgeHandoverInstitution | null }) {
  const t = useT();
  const phone = institution?.phone?.trim() || null;
  const email = institution?.email?.trim() || null;
  const website = normalizeWebsite(institution?.website);
  const dropOff = institution?.drop_off_hours?.trim() || null;
  const hours = institution?.working_hours?.trim() || null;
  const hidden = Boolean(institution?.is_location_hidden);
  // A hidden location's public address is its area, which is often just the
  // city again; say it once.
  const place = [...new Set([institution?.address, institution?.city].filter(Boolean))].join(", ");
  const hasContact = Boolean(phone || email || website);

  return (
    <section className="rounded-control border border-border-subtle bg-surface-sunken p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
        {t("pledge.next_title")}
      </h3>
      <p className="mt-1.5 text-base font-medium text-ink">{t("pledge.next_step")}</p>
      <p className="mt-1 text-sm text-ink-secondary">{t("pledge.next_notified")}</p>

      {institution ? (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          {phone ? (
            <RosterFact icon={<Phone className="h-4 w-4" aria-hidden />} label={t("institution_detail.phone")}>
              <a
                href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                className="font-medium text-brand underline-offset-2 hover:underline"
              >
                {phone}
              </a>
            </RosterFact>
          ) : null}
          {email ? (
            <RosterFact icon={<Mail className="h-4 w-4" aria-hidden />} label={t("institution_detail.email")}>
              <a
                href={`mailto:${email}`}
                className="break-all font-medium text-brand underline-offset-2 hover:underline"
              >
                {email}
              </a>
            </RosterFact>
          ) : null}
          {website ? (
            <RosterFact icon={<Globe className="h-4 w-4" aria-hidden />} label={t("institution_detail.website")}>
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-medium text-brand underline-offset-2 hover:underline"
              >
                {websiteLabel(website)}
              </a>
            </RosterFact>
          ) : null}
          {place ? (
            <RosterFact
              icon={<MapPin className="h-4 w-4" aria-hidden />}
              label={t(hidden ? "pledge.handover_area" : "institution_detail.address")}
            >
              {place}
              {hidden ? (
                <span className="block text-ink-secondary">{t("pledge.handover_hidden")}</span>
              ) : null}
            </RosterFact>
          ) : null}
          {dropOff ? (
            <RosterFact icon={<PackageOpen className="h-4 w-4" aria-hidden />} label={t("pledge.handover_dropoff")}>
              <span className="whitespace-pre-line">{dropOff}</span>
            </RosterFact>
          ) : null}
          {hours ? (
            <RosterFact icon={<Clock className="h-4 w-4" aria-hidden />} label={t("institution_detail.working_hours")}>
              {hours}
            </RosterFact>
          ) : null}
        </dl>
      ) : null}

      {institution && !hasContact ? (
        <p className="mt-3 text-sm text-ink-secondary">
          {t("pledge.handover_no_contact")}{" "}
          <Link
            href={`/institution/${institution.id}`}
            className="font-semibold text-brand underline-offset-2 hover:underline"
          >
            {t("pledge.handover_profile")}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

export function PledgeDetailsDialog({
  pledge,
  onClose,
  footer,
}: {
  pledge: PledgeDetails | null;
  onClose: () => void;
  /** E.g. the withdraw control, so the pledge can be cancelled from here. */
  footer?: ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const need = pledge?.need;
  if (!pledge || !need) return null;
  const institution = need.institution;
  const deadline = need.deadline
    ? format(parseISO(need.deadline.slice(0, 10)), "EEEE, d. MMMM yyyy.", { locale: locale === "hr" ? hr : enUS })
    : null;
  const needed = need.quantity_needed ?? null;
  const pledged = need.quantity_pledged ?? null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={need.title}
      description={t("your_pledges.you_pledged").replace("{qty}", String(pledge.quantity))}
      closeLabel={t("common.close")}
      variant="sheet-on-mobile"
      footer={footer}
    >
      <div className="space-y-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {institution ? (
            <RosterFact icon={<Building2 className="h-4 w-4" aria-hidden />} label={t("volunteer_card.organiser")}>
              <Link href={`/institution/${institution.id}`} className="font-medium underline-offset-2 hover:text-brand hover:underline">
                {institution.name}
              </Link>
            </RosterFact>
          ) : null}
          <RosterFact icon={<CalendarClock className="h-4 w-4" aria-hidden />} label={t("institution.roster_deadline")}>
            {deadline ?? t("institution.roster_no_deadline")}
          </RosterFact>
          <RosterFact icon={<CalendarDays className="h-4 w-4" aria-hidden />} label={t("profile_calendar.pledged")}>
            {timeAgo(pledge.created_at, locale)}
          </RosterFact>
        </dl>
        <PledgeHandover institution={institution} />
        {need.description ? (
          <RosterSection title={t("profile_calendar.about_need")}>{need.description}</RosterSection>
        ) : null}
        {pledge.message ? (
          <RosterSection title={t("your_pledges.your_message")}>{pledge.message}</RosterSection>
        ) : null}
        {pledged != null && needed ? (
          <div>
            <div className="flex justify-between text-sm text-ink-tertiary">
              <span>{t("profile_calendar.pledged")}</span>
              <span className="tabular-nums">{pledged} / {needed}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Math.round((pledged / needed) * 100))}%` }} />
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
