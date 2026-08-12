"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BadgeCheck, Building2, MapPin, PackageSearch } from "lucide-react";
import clsx from "clsx";
import { FilterChip } from "@/components/FilterBar";
import { useLocale, useT } from "@/i18n/client";
import type {
  EngagedAssociationItem,
  EngagedDirectoryResponse,
} from "@/lib/association-registry";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
  SkeletonText,
  buttonClasses,
} from "@/components/ui";

function EngagedCardSkeleton() {
  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-6 w-full" />
      <SkeletonText className="mt-3" lines={2} />
      <Skeleton className="mt-6 h-11 w-36 rounded-full" />
    </Card>
  );
}

function EngagedCard({ item }: { item: EngagedAssociationItem }) {
  const t = useT();
  const { locale } = useLocale();

  return (
    <Card className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2">
        {item.is_verified ? (
          <Badge tone="success" size="sm" icon={<BadgeCheck className="h-3 w-3" aria-hidden />}>
            {t("map_ui.status_verified")}
          </Badge>
        ) : (
          <Badge tone="neutral" size="sm" icon={<Building2 className="h-3 w-3" aria-hidden />}>
            {t("map_ui.status_onboarded")}
          </Badge>
        )}
        {item.urgent_needs > 0 ? (
          <Badge tone="warning" size="sm">
            {t("organisations_active.urgent_count", {
              count: item.urgent_needs.toLocaleString(locale),
            })}
          </Badge>
        ) : null}
      </div>

      <h3 className="mt-3 line-clamp-2 text-base font-semibold leading-snug text-ink">
        {item.name}
      </h3>

      {item.city ? (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-secondary">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {item.city}
            {item.county ? ` · ${item.county}` : ""}
          </span>
        </p>
      ) : null}

      <p className="mt-3 text-sm text-ink-secondary">
        {item.open_needs > 0
          ? t("organisations_active.open_count", {
              count: item.open_needs.toLocaleString(locale),
            })
          : t("organisations_active.no_open")}
      </p>

      <div className="mt-auto pt-5">
        <Link
          href={`/institution/${item.institution_id}`}
          className={buttonClasses({ variant: "secondary", size: "sm" })}
        >
          {t("organisations_active.open_profile")}
        </Link>
      </div>
    </Card>
  );
}

/**
 * The organisations that can actually be helped today.
 *
 * The register view lists every association the state records; this one lists
 * the small subset with an account here, newest needs first. Keeping them
 * apart is deliberate — presence in the register is not confirmation that an
 * organisation accepts anything, and merging the two lists would imply it.
 */
export function ActiveView({
  onlyWithNeeds,
  onlyVerified,
  onToggleNeeds,
  onToggleVerified,
}: {
  onlyWithNeeds: boolean;
  onlyVerified: boolean;
  onToggleNeeds: () => void;
  onToggleVerified: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [data, setData] = useState<EngagedDirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [settled, setSettled] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (onlyWithNeeds) params.set("withNeeds", "true");
    if (onlyVerified) params.set("verified", "true");
    return params.toString();
  }, [onlyWithNeeds, onlyVerified]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    fetch(`/api/v1/organisations/engaged${queryString ? `?${queryString}` : ""}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<EngagedDirectoryResponse>;
      })
      .then(setData)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setSettled(true);
        }
      });
    return () => controller.abort();
  }, [queryString, retry]);

  const coldLoad = loading && !settled;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <FilterChip aria-pressed={onlyWithNeeds} onClick={onToggleNeeds}>
          {t("organisations_active.filter_with_needs")}
        </FilterChip>
        <FilterChip aria-pressed={onlyVerified} onClick={onToggleVerified}>
          {t("organisations_active.filter_verified")}
        </FilterChip>
        {data && !coldLoad ? (
          <p aria-live="polite" className="ml-auto text-sm text-ink-secondary">
            {t("organisations_active.count", {
              count: data.meta.total.toLocaleString(locale),
            })}
          </p>
        ) : null}
      </div>

      {coldLoad ? (
        <div
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          role="status"
          aria-label={t("organisations.loading")}
        >
          {Array.from({ length: 6 }, (_, index) => (
            <EngagedCardSkeleton key={index} />
          ))}
        </div>
      ) : failed ? (
        <div role="alert">
          <EmptyState
            icon={<AlertTriangle className="h-10 w-10" aria-hidden />}
            title={t("organisations_active.error")}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSettled(false);
                  setRetry((value) => value + 1);
                }}
              >
                {t("errors.retry")}
              </Button>
            }
          />
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<PackageSearch className="h-10 w-10" aria-hidden />}
          title={t("organisations_active.empty")}
          description={t("organisations_active.empty_hint")}
        />
      ) : (
        <div
          className={clsx(
            "grid gap-4 transition-opacity duration-150 ease-out md:grid-cols-2 xl:grid-cols-3",
            loading && "opacity-60"
          )}
          aria-busy={loading}
        >
          {data.items.map((item) => (
            <EngagedCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}
