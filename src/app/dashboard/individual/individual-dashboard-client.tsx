"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Clock, Heart, MapPin, PackageCheck } from "lucide-react";
import type { AuthProfile } from "@/lib/auth/profile";
import type { Pledge, Shipment } from "@/lib/types";
import { DONATION_TYPES } from "@/lib/constants";
import { useT } from "@/i18n/client";
import type { AppRole } from "@/lib/auth/roles";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  PageShell,
  SectionHeader,
  Skeleton,
  Stat,
  buttonClasses,
} from "@/components/ui";
import type { BadgeTone } from "@/components/ui";

type PledgeRow = Pledge & {
  need?: {
    id: string;
    title: string;
    donation_type: string;
    institution?: { id: string; name: string; category: string };
  };
  shipment?: Shipment | null;
};

/** The same status vocabulary the map surface uses (`YourPledgesSection`). */
const STATUS: Record<string, { tone: BadgeTone; key: string }> = {
  pledged: { tone: "warning", key: "your_pledges.status_pledged" },
  delivered: { tone: "info", key: "your_pledges.status_delivered" },
  confirmed: { tone: "success", key: "your_pledges.status_confirmed" },
  cancelled: { tone: "neutral", key: "your_pledges.status_cancelled" },
};

function roleTranslationKey(role: AppRole): string {
  if (role === "ngo") return "dashboard_individual.role_ngo";
  if (role === "company") return "dashboard_individual.role_company";
  if (role === "superadmin") return "dashboard_individual.role_superadmin";
  return "dashboard_individual.role_individual";
}

export function IndividualDashboardClient({ profile }: { profile: AuthProfile }) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pledges, setPledges] = useState<PledgeRow[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pledges", { credentials: "include" });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(typeof json.error === "string" ? json.error : t("common.error_generic"));
          return;
        }
        setLoadError(null);
        setPledges(json.pledges ?? []);
      } catch {
        if (!cancelled) setLoadError(t("common.error_generic"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, t]);

  const recent = pledges.slice(0, 8);
  const withShipment = pledges.filter((item) => item.shipment).length;

  return (
    <PageShell width="content">
      <PageHeader
        title={t("dashboard_individual.title")}
        subtitle={t("dashboard_individual.subtitle")}
        actions={
          <Link href="/map" className={buttonClasses()}>
            <MapPin className="h-4 w-4" aria-hidden="true" />
            {t("dashboard_individual.find_places")}
          </Link>
        }
      />

      <div className="space-y-8">
        <Card padding="lg" aria-labelledby="account-heading">
          <SectionHeader
            title={
              <span id="account-heading">{t("dashboard_individual.your_account")}</span>
            }
          />
          <p className="text-lg font-semibold text-ink">{profile.name}</p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
                {t("dashboard_individual.email_label")}
              </dt>
              <dd className="mt-0.5 break-all text-base text-ink">{profile.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
                {t("dashboard_individual.role_label")}
              </dt>
              <dd className="mt-0.5 text-base text-ink">{t(roleTranslationKey(profile.role))}</dd>
            </div>
          </dl>
        </Card>

        <section className="grid gap-4 sm:grid-cols-3">
          <Stat
            icon={<Heart className="h-4 w-4" aria-hidden="true" />}
            label={t("dashboard_individual.stat_donations")}
            value={loading ? <Skeleton className="h-8 w-12" /> : pledges.length}
          />
          <Stat
            icon={<PackageCheck className="h-4 w-4" aria-hidden="true" />}
            label={t("dashboard_individual.stat_shipping")}
            value={loading ? <Skeleton className="h-8 w-12" /> : withShipment}
          />
          {/* This was a hardcoded `0` presented as a measurement. There is no
              volunteer-hours query on this surface yet, so it shows an em-dash
              in the muted tone rather than a fabricated figure. A localised
              "not available yet" caption needs a translation key that does not
              exist yet — see the handover note. */}
          <Stat
            icon={<Clock className="h-4 w-4" aria-hidden="true" />}
            label={t("dashboard_individual.stat_volunteer_hours")}
            tone="muted"
            value="—"
          />
        </section>

        <section>
          <SectionHeader title={t("dashboard_individual.donation_history")} />
          {loading ? (
            <ul className="space-y-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24 rounded-card" />
              ))}
            </ul>
          ) : loadError ? (
            <EmptyState
              title={t("errors.generic_title")}
              description={loadError}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setLoading(true);
                    setReload((n) => n + 1);
                  }}
                >
                  {t("errors.retry")}
                </Button>
              }
            />
          ) : recent.length === 0 ? (
            <EmptyState
              title={t("dashboard_individual.no_actions")}
              action={
                <Link href="/map" className={buttonClasses({ variant: "secondary" })}>
                  {t("dashboard_individual.find_places")}
                </Link>
              }
            />
          ) : (
            <ul className="space-y-3">
              {recent.map((pl) => {
                const need = pl.need;
                const typeLabel = need
                  ? DONATION_TYPES[need.donation_type as keyof typeof DONATION_TYPES]?.label ??
                    need.donation_type
                  : "";
                const when = formatDistanceToNow(new Date(pl.created_at), { addSuffix: true });
                const status = STATUS[pl.status] ?? STATUS.pledged!;
                return (
                  <li
                    key={pl.id}
                    className="rounded-card border border-border-subtle bg-surface-raised p-4 shadow-raised"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{need?.title ?? "—"}</p>
                        <p className="text-sm text-ink-secondary">
                          {need?.institution?.name ?? "—"}
                        </p>
                        <p className="mt-1 text-xs text-ink-tertiary">{typeLabel}</p>
                        {pl.shipment ? (
                          <p className="mt-1 text-xs text-info">
                            {t("dashboard_individual.shipment_prefix")} {pl.shipment.status}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
                        <Badge tone={status.tone}>{t(status.key)}</Badge>
                        <time dateTime={pl.created_at} className="text-xs text-ink-tertiary">
                          {when}
                        </time>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}
