"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { VolunteerEventCard } from "@/components/VolunteerEventCard";
import { PageShell } from "@/components/ui";
import { DEMO_VOLUNTEER_EVENTS } from "@/lib/demo/volunteer-showcase-events";
import { useT } from "@/i18n/client";

const VOLUNTEER_SIGN_IN_HREF =
  "/auth/login?next=" + encodeURIComponent("/volunteer");

export default function DemoVolunteerShowcasePage() {
  const t = useT();
  const [featured, ...rest] = DEMO_VOLUNTEER_EVENTS;

  return (
    <PageShell>
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold leading-tight tracking-[-0.02em] text-ink sm:text-4xl">
          {t("demo.volunteer_showcase_title")}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-ink-secondary">
          {t("demo.volunteer_showcase_subtitle")}
        </p>
        <p className="mt-4 text-sm">
          <Link
            href="/demo/ngo-plans"
            className="font-medium text-brand underline-offset-4 transition-colors hover:text-brand-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {t("demo.link_ngo_plans")}
          </Link>
        </p>
      </header>

      <div className="flex flex-col gap-10">
        <section aria-label={t("demo.featured_placement")}>
          <div className="relative z-10 lg:px-1">
            <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white shadow-overlay">
                <Megaphone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("demo.featured_placement")}
              </span>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-on-soft">
                {t("demo.featured_placement_detail")}
              </p>
            </div>
            {/* A paid placement should read as elevated, not as a different
                product — one brand ring instead of a stacked gradient frame. */}
            <div className="rounded-card bg-brand p-[3px] shadow-overlay">
              <div className="overflow-hidden rounded-[calc(var(--radius-card)-3px)] bg-surface-raised">
                <VolunteerEventCard
                  event={featured}
                  readOnly
                  readOnlyHref={VOLUNTEER_SIGN_IN_HREF}
                  readOnlyLabel={t("demo.volunteer_sign_in_cta")}
                />
              </div>
            </div>
          </div>
        </section>

        <section aria-label={t("demo.volunteer_showcase_more")}>
          <h2 className="mb-4 text-center text-lg font-semibold text-ink sm:text-left">
            {t("demo.volunteer_showcase_more")}
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {rest.map((event) => (
              <VolunteerEventCard
                key={event.id}
                event={event}
                readOnly
                readOnlyHref={VOLUNTEER_SIGN_IN_HREF}
                readOnlyLabel={t("demo.volunteer_sign_in_cta")}
              />
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
