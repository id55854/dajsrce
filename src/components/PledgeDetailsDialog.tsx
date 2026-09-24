"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { enUS, hr } from "date-fns/locale";
import { Building2, CalendarClock, CalendarDays, MapPin } from "lucide-react";
import { useLocale, useT } from "@/i18n/client";
import { timeAgo } from "@/lib/utils";
import { RosterFact, RosterSection } from "@/components/Roster";
import { Dialog } from "@/components/ui";

/**
 * What the pledge details dialog reads. Both the profile's donation history
 * and the "your pledges" summary on /doniraj pass rows from GET /api/pledges,
 * so one dialog serves both and they cannot drift apart.
 */
export type PledgeDetails = {
  quantity: number;
  created_at: string;
  need?: {
    title: string;
    description?: string | null;
    deadline?: string | null;
    quantity_needed?: number | null;
    quantity_pledged?: number | null;
    institution?: { id: string; name: string; address?: string | null; city?: string | null } | null;
  } | null;
};

export function PledgeDetailsDialog({ pledge, onClose }: { pledge: PledgeDetails | null; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const need = pledge?.need;
  if (!pledge || !need) return null;
  const institution = need.institution;
  const place = [institution?.address, institution?.city].filter(Boolean).join(", ");
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
          {place ? (
            <RosterFact icon={<MapPin className="h-4 w-4" aria-hidden />} label={t("volunteer_card.where")}>
              {place}
            </RosterFact>
          ) : null}
          <RosterFact icon={<CalendarClock className="h-4 w-4" aria-hidden />} label={t("institution.roster_deadline")}>
            {deadline ?? t("institution.roster_no_deadline")}
          </RosterFact>
          <RosterFact icon={<CalendarDays className="h-4 w-4" aria-hidden />} label={t("profile_calendar.pledged")}>
            {timeAgo(pledge.created_at, locale)}
          </RosterFact>
        </dl>
        {need.description ? (
          <RosterSection title={t("profile_calendar.about_need")}>{need.description}</RosterSection>
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
