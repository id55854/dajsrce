"use client";

import { Suspense, useEffect, useId, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BadgeCheck,
  CalendarPlus,
  ExternalLink,
  MapPin,
  Plus,
} from "lucide-react";
import { InstitutionPledgesClient } from "./pledges/institution-pledges-client";
import { InstitutionVolunteersClient } from "./volunteers/institution-volunteers-client";
import { useLocale, useT } from "@/i18n/client";
import { CATEGORY_CONFIG, categoryVars } from "@/lib/constants";
import { NewVolunteerEventForm } from "@/components/NewVolunteerEventForm";
import { NewNeedForm } from "@/components/NewNeedForm";
import { InstitutionCalendar } from "@/components/InstitutionCalendar";
import { SignOutButton } from "@/components/SignOutButton";
import type { PublicInstitutionDetail } from "@/lib/location-map";
import {
  Button,
  Card,
  PageHeader,
  PageShell,
  Skeleton,
  buttonClasses,
} from "@/components/ui";

/**
 * Inbound pledges and volunteer management are two halves of "what is coming
 * in", so they are views of one strip here rather than two pages the profile
 * links out to; the same shape `/doniraj` uses. Pledges is the default view;
 * both keep their own routes for direct links.
 */
const VIEWS = ["pledges", "volunteers"] as const;
type View = (typeof VIEWS)[number];

const DEFAULT_VIEW: View = "pledges";

function parseView(raw: string | null): View {
  return VIEWS.includes(raw as View) ? (raw as View) : DEFAULT_VIEW;
}

export default function InstitutionDashboardPage() {
  return (
    <Suspense fallback={null}>
      <InstitutionDashboardExperience />
    </Suspense>
  );
}

function InstitutionDashboardExperience() {
  const t = useT();

  const searchParams = useSearchParams();
  const view = parseView(searchParams.get("view"));

  const [institution, setInstitution] = useState<PublicInstitutionDetail | null>(null);
  const [institutionLoading, setInstitutionLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/institution", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { institution?: PublicInstitutionDetail | null } | null) => {
        if (!cancelled) setInstitution(json?.institution ?? null);
      })
      .catch(() => {
        if (!cancelled) setInstitution(null);
      })
      .finally(() => {
        if (!cancelled) setInstitutionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [refreshKey, setRefreshKey] = useState(0);
  const refreshActivity = () => setRefreshKey((value) => value + 1);
  const needPanelId = useId();
  const eventPanelId = useId();
  const [panel, setPanel] = useState<"need" | "event" | null>(null);


  return (
    <PageShell width="wide">
      <div className="space-y-6">
        {/* Who the account is acting as, in one compact header. The full
            public detail panel used to sit here, which pushed everything the
            organisation actually works with below the fold; the public page
            is one click away. */}
        {institutionLoading ? (
          <Skeleton className="h-32 rounded-card" />
        ) : institution ? (
          <ProfileHeader
            institution={institution}
            panel={panel}
            needPanelId={needPanelId}
            eventPanelId={eventPanelId}
            onToggle={(next) => setPanel((current) => (current === next ? null : next))}
          />
        ) : (
          <PageHeader
            title={t("institution.dashboard_title")}
            subtitle={t("institution.dashboard_subtitle")}
          />
        )}

        {/* These were in-page cards wearing modal-weight `shadow-lg` with no
            focus move, no Escape, no scrim and no dialog role. They are honest
            inline sections now: normal card elevation and a real close button. */}
        {panel === "need" ? (
          <NewNeedForm panelId={needPanelId} onClose={() => setPanel(null)} onPosted={refreshActivity} />
        ) : null}

        {panel === "event" ? (
          <NewVolunteerEventForm panelId={eventPanelId} onClose={() => setPanel(null)} onPosted={refreshActivity} />
        ) : null}

        <InstitutionCalendar refreshKey={refreshKey} />

        {/* The selected half of the profile, with its switch directly above it:
            the profile's own actions sit higher up, and a strip parked under
            the page heading would have been four controls away from what it
            controls. Same pill recipe as /doniraj. Both halves keep their own
            routes, so a bookmark or a direct link still lands on the
            standalone page. */}
        <section className="border-t border-border-subtle pt-6">
          <nav
            aria-label={t("institution.dashboard_views_label")}
            className="mb-6 flex flex-wrap gap-2"
          >
            {VIEWS.map((candidate) => {
              const active = candidate === view;
              return (
                <Link
                  key={candidate}
                  href={
                    candidate === DEFAULT_VIEW
                      ? "/dashboard/institution"
                      : `/dashboard/institution?view=${candidate}`
                  }
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white"
                      : "rounded-full border border-border-subtle px-4 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
                  }
                >
                  {t(`institution.dashboard_view_${candidate}`)}
                </Link>
              );
            })}
          </nav>

          {view === "pledges" ? (
            <InstitutionPledgesClient embedded refreshKey={refreshKey} />
          ) : (
            <InstitutionVolunteersClient embedded refreshKey={refreshKey} />
          )}
        </section>

        <div className="border-t border-border-subtle pt-6">
          <SignOutButton />
        </div>
      </div>
    </PageShell>
  );
}

function ProfileHeader({
  institution,
  panel,
  needPanelId,
  eventPanelId,
  onToggle,
}: {
  institution: PublicInstitutionDetail;
  panel: "need" | "event" | null;
  needPanelId: string;
  eventPanelId: string;
  onToggle: (panel: "need" | "event") => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const category = institution.category in CATEGORY_CONFIG ? CATEGORY_CONFIG[institution.category] : null;
  const place = [institution.isLocationHidden ? null : institution.address, institution.city]
    .filter(Boolean)
    .join(", ");

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight tracking-[-0.01em] text-ink">
            {institution.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
            {category ? (
              <span
                style={categoryVars(institution.category)}
                className="category-chip inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
              >
                {locale === "hr" ? category.labelHr : category.label}
              </span>
            ) : null}
            {institution.isVerified ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                <BadgeCheck className="h-4 w-4" aria-hidden />
                {t("map_ui.verified")}
              </span>
            ) : null}
            {place ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
                <span className="truncate">{place}</span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href={`/institution/${institution.id}`}
            className={buttonClasses({ variant: "ghost", size: "sm" })}
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            {t("institution.dashboard_public_profile")}
          </Link>
          <Link href="/" className={buttonClasses({ variant: "ghost", size: "sm" })}>
            <MapPin className="h-4 w-4" aria-hidden />
            {t("institution.dashboard_view_map")}
          </Link>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-border-subtle pt-4">
        <Button
          aria-expanded={panel === "need"}
          aria-controls={needPanelId}
          onClick={() => onToggle("need")}
          icon={<Plus className="h-4 w-4" aria-hidden="true" />}
        >
          {t("institution.dashboard_new_need")}
        </Button>
        <Button
          variant="secondary"
          aria-expanded={panel === "event"}
          aria-controls={eventPanelId}
          onClick={() => onToggle("event")}
          icon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}
        >
          {t("institution.dashboard_new_event")}
        </Button>
      </div>
    </Card>
  );
}
