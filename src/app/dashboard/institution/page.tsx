"use client";

import { Suspense, useEffect, useId, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CalendarPlus,
  MapPin,
  Plus,
} from "lucide-react";
import { InstitutionPledgesClient } from "./pledges/institution-pledges-client";
import { InstitutionVolunteersClient } from "./volunteers/institution-volunteers-client";
import { useT } from "@/i18n/client";
import { NewVolunteerEventForm } from "@/components/NewVolunteerEventForm";
import { NewNeedForm } from "@/components/NewNeedForm";
import { InstitutionCalendar } from "@/components/InstitutionCalendar";
import { SignOutButton } from "@/components/SignOutButton";
import {
  InstitutionDetailPanel,
  InstitutionDetailSkeleton,
} from "@/components/InstitutionDetailPanel";
import type { PublicInstitutionDetail } from "@/lib/location-map";
import {
  Button,
  PageHeader,
  PageShell,
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
      <PageHeader
        title={t("institution.dashboard_title")}
        subtitle={t("institution.dashboard_subtitle")}
      />

      <div className="space-y-6">
        {/* Who the account is acting as, laid out the same way a visitor sees
            it on the public page: the console below had every lever for
            running the organisation but never said which one it was. */}
        {institutionLoading ? (
          <InstitutionDetailSkeleton />
        ) : institution ? (
          <InstitutionDetailPanel institution={institution} showCloseButton={false} />
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            size="lg"
            fullWidth
            aria-expanded={panel === "need"}
            aria-controls={needPanelId}
            onClick={() => setPanel((current) => (current === "need" ? null : "need"))}
            icon={<Plus className="h-5 w-5" aria-hidden="true" />}
          >
            {t("institution.dashboard_new_need")}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            fullWidth
            aria-expanded={panel === "event"}
            aria-controls={eventPanelId}
            onClick={() => {
              setPanel((current) => (current === "event" ? null : "event"));
            }}
            icon={<CalendarPlus className="h-5 w-5" aria-hidden="true" />}
          >
            {t("institution.dashboard_new_event")}
          </Button>
        </div>

        {/* These were in-page cards wearing modal-weight `shadow-lg` with no
            focus move, no Escape, no scrim and no dialog role. They are honest
            inline sections now: normal card elevation and a real close button. */}
        {panel === "need" ? (
          <NewNeedForm panelId={needPanelId} onClose={() => setPanel(null)} onPosted={refreshActivity} />
        ) : null}

        {panel === "event" ? (
          <NewVolunteerEventForm panelId={eventPanelId} onClose={() => setPanel(null)} onPosted={refreshActivity} />
        ) : null}

        <div>
          <Link
            href="/"
            className={buttonClasses({ variant: "primary", size: "lg", className: "w-full sm:w-auto" })}
          >
            <MapPin className="h-5 w-5" aria-hidden="true" />
            {t("institution.dashboard_view_map")}
          </Link>
        </div>

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
