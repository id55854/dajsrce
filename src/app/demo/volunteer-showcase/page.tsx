"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { VolunteerEventCard } from "@/components/VolunteerEventCard";
import { DEMO_VOLUNTEER_EVENTS } from "@/lib/demo/volunteer-showcase-events";
import { useT } from "@/i18n/client";

const VOLUNTEER_SIGN_IN_HREF =
  "/auth/login?next=" + encodeURIComponent("/volunteer");

export default function DemoVolunteerShowcasePage() {
  const t = useT();
  const [featured, ...rest] = DEMO_VOLUNTEER_EVENTS;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {t("demo.volunteer_showcase_title")}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-lg text-gray-600 dark:text-gray-400">
          {t("demo.volunteer_showcase_subtitle")}
        </p>
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-500">
          <Link
            href="/demo/ngo-plans"
            className="font-medium text-red-500 underline-offset-4 hover:text-red-600 hover:underline"
          >
            {t("demo.link_ngo_plans")}
          </Link>
        </p>
      </header>

      <div className="flex flex-col gap-10">
        <section aria-label={t("demo.featured_placement")}>
          <div className="relative z-10 lg:scale-[1.02] lg:px-1">
            <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-gradient-to-r from-red-500 to-red-700 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                <Megaphone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("demo.featured_placement")}
              </span>
              <p className="text-xs font-medium uppercase tracking-wide text-red-600 dark:text-red-400">
                {t("demo.featured_placement_detail")}
              </p>
            </div>
            <div className="rounded-2xl bg-gradient-to-br from-red-400 via-red-600 to-red-900 p-[3px] shadow-xl shadow-red-600/25 dark:from-red-500 dark:via-red-700 dark:to-red-950 dark:shadow-red-950/40">
              <div className="rounded-[14px] bg-white ring-2 ring-red-400/25 dark:bg-gray-950 dark:ring-red-500/25">
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
          <h2 className="mb-4 text-center text-lg font-semibold text-gray-800 dark:text-gray-200 sm:text-left">
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
    </div>
  );
}
