"use client";

import Link from "next/link";
import { BadgeCheck, Check } from "lucide-react";
import { PageShell, buttonClasses } from "@/components/ui";
import { useT } from "@/i18n/client";

export default function DemoNgoPlansPage() {
  const t = useT();

  const tiers = [
    {
      key: "standard" as const,
      icon: Check,
      cardClass: "border border-border-subtle bg-surface-raised",
      iconWrapClass: "bg-brand-soft text-brand-on-soft",
      checkClass: "text-brand",
      buttonClass: buttonClasses({ variant: "secondary", fullWidth: true }),
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
      cardClass: "border border-transparent bg-brand-soft",
      iconWrapClass: "bg-brand text-white shadow-raised",
      checkClass: "text-brand",
      buttonClass: buttonClasses({ fullWidth: true }),
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
    <PageShell>
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold leading-tight tracking-[-0.02em] text-ink sm:text-4xl">
          {t("demo.ngo_plans_title")}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-ink-secondary">
          {t("demo.ngo_plans_subtitle")}
        </p>
        <p className="mt-4 text-sm">
          <Link
            href="/demo/volunteer-showcase"
            className="font-medium text-brand underline-offset-4 transition-colors hover:text-brand-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {t("demo.link_volunteer_showcase")}
          </Link>
        </p>
      </header>

      <div className="mx-auto grid max-w-5xl grid-cols-1 items-stretch gap-8 lg:grid-cols-2">
        {tiers.map((tier) => {
          const Icon = tier.icon;
          return (
            <div
              key={tier.key}
              className={`relative flex h-full flex-col rounded-card p-6 ${tier.cardClass} ${
                // The recommended tier earns one elevation step, not a second
                // visual identity.
                tier.verifiedSpotlight
                  ? "shadow-overlay ring-2 ring-brand"
                  : "shadow-raised"
              }`}
            >
              {tier.verifiedSpotlight ? (
                <span className="absolute -top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white shadow-overlay">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("demo.tier_badge_verified")}
                </span>
              ) : null}

              <div className="mb-4 flex items-center gap-2">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${tier.iconWrapClass}`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 className="text-xl font-semibold text-ink">{tier.name}</h2>
              </div>

              <p className="mb-6">
                <span className="text-3xl font-bold tracking-[-0.02em] text-ink">
                  {tier.price}
                </span>
                <span className="text-ink-tertiary"> / {tier.period}</span>
              </p>

              <ul className="mb-8 flex flex-1 flex-col gap-3 text-base text-ink-secondary">
                {tier.features.map((line) => (
                  <li key={line} className="flex gap-2">
                    <Check
                      className={`mt-0.5 h-4 w-4 shrink-0 ${tier.checkClass}`}
                      aria-hidden="true"
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <Link href="/auth/register" className={tier.buttonClass}>
                {t("demo.tier_cta")}
              </Link>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
