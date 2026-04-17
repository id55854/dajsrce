"use client";

import Link from "next/link";
import { BadgeCheck, Check } from "lucide-react";
import { useT } from "@/i18n/client";

export default function DemoNgoPlansPage() {
  const t = useT();

  const tiers = [
    {
      key: "standard" as const,
      icon: Check,
      cardClass:
        "border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900",
      iconWrapClass: "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400",
      checkClass: "text-red-500",
      buttonClass:
        "border border-gray-200 bg-white text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700/80",
      verifiedSpotlight: false,
      name: t("demo.tier_standard_name"),
      price: t("demo.tier_standard_price"),
      period: t("demo.tier_standard_period"),
      features: [
        t("demo.tier_standard_f1"),
        t("demo.tier_standard_f2"),
        t("demo.tier_standard_f3"),
      ],
    },
    {
      key: "verified" as const,
      icon: BadgeCheck,
      cardClass:
        "border-0 bg-gradient-to-b from-red-50/90 via-white to-white dark:from-red-950/50 dark:via-gray-900 dark:to-gray-900",
      iconWrapClass:
        "bg-gradient-to-br from-red-500 to-red-700 text-white shadow-md shadow-red-900/25",
      checkClass: "text-red-600 dark:text-red-400",
      buttonClass:
        "border border-red-400/70 bg-gradient-to-r from-red-500 to-red-600 text-white shadow-md shadow-red-600/25 hover:from-red-600 hover:to-red-700 dark:border-red-700 dark:from-red-600 dark:to-red-700 dark:hover:from-red-500 dark:hover:to-red-600",
      verifiedSpotlight: true,
      name: t("demo.tier_verified_name"),
      price: t("demo.tier_verified_price"),
      period: t("demo.tier_verified_period"),
      features: [
        t("demo.tier_verified_f1"),
        t("demo.tier_verified_f2"),
        t("demo.tier_verified_f3"),
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {t("demo.ngo_plans_title")}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-lg text-gray-600 dark:text-gray-400">
          {t("demo.ngo_plans_subtitle")}
        </p>
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-500">
          <Link
            href="/demo/volunteer-showcase"
            className="font-medium text-red-500 underline-offset-4 hover:text-red-600 hover:underline"
          >
            {t("demo.link_volunteer_showcase")}
          </Link>
        </p>
      </header>

      <div className="mx-auto grid max-w-5xl grid-cols-1 items-stretch gap-8 lg:grid-cols-2 lg:items-center">
        {tiers.map((tier) => {
          const Icon = tier.icon;
          const inner = (
            <div
              className={`relative flex h-full flex-col rounded-[14px] p-6 ${tier.cardClass} ${
                tier.verifiedSpotlight
                  ? "shadow-2xl shadow-red-500/20 ring-2 ring-red-400/45 dark:shadow-red-950/40 dark:ring-red-500/35"
                  : ""
              }`}
            >
              {tier.verifiedSpotlight ? (
                <span className="absolute -top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-gradient-to-r from-red-500 to-red-700 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                  {t("demo.tier_badge_verified")}
                </span>
              ) : null}
              <div className="mb-4 flex items-center gap-2">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${tier.iconWrapClass}`}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {tier.name}
                </h2>
              </div>
              <p className="mb-6">
                <span
                  className={`text-3xl font-bold ${
                    tier.verifiedSpotlight
                      ? "bg-gradient-to-r from-red-700 to-red-600 bg-clip-text text-transparent dark:from-red-300 dark:to-red-400"
                      : "text-gray-900 dark:text-gray-50"
                  }`}
                >
                  {tier.price}
                </span>
                <span className="text-gray-500 dark:text-gray-400"> / {tier.period}</span>
              </p>
              <ul className="mb-8 flex flex-1 flex-col gap-3 text-sm text-gray-700 dark:text-gray-300">
                {tier.features.map((line) => (
                  <li key={line} className="flex gap-2">
                    <Check
                      className={`mt-0.5 h-4 w-4 shrink-0 ${tier.checkClass}`}
                      aria-hidden
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/register"
                className={`w-full rounded-full py-3 text-center text-sm font-semibold transition-colors ${tier.buttonClass}`}
              >
                {t("demo.tier_cta")}
              </Link>
            </div>
          );

          return (
            <div
              key={tier.key}
              className={
                tier.verifiedSpotlight
                  ? "relative z-10 lg:scale-[1.06] lg:px-1"
                  : "relative z-0"
              }
            >
              {tier.verifiedSpotlight ? (
                <div className="rounded-2xl bg-gradient-to-br from-red-400 via-red-600 to-red-900 p-[3px] shadow-xl shadow-red-600/30 dark:from-red-500 dark:via-red-700 dark:to-red-950 dark:shadow-red-950/40">
                  {inner}
                </div>
              ) : (
                inner
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
