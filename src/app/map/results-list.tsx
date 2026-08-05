"use client";

import clsx from "clsx";
import { ChevronRight, SearchX, ZoomOut } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import {
  InstitutionCard,
  InstitutionCardSkeleton,
} from "@/components/InstitutionCard";
import { useT } from "@/i18n/client";
import { formatDistance } from "@/lib/utils";
import type { PublicMapCluster, PublicMapInstitution } from "@/lib/location-map";

export type InstitutionRow = {
  institution: PublicMapInstitution;
  distance: number | null;
};

export type ClusterRow = {
  cluster: PublicMapCluster;
  distance: number | null;
};

export type ResultsListProps = {
  mode: "clusters" | "institutions";
  /** Cold load: no features have arrived yet. */
  loading: boolean;
  /** Warm refetch: the rows on screen are stale but still usable. */
  refreshing: boolean;
  institutionRows: InstitutionRow[];
  clusterRows: ClusterRow[];
  selectedId: string | null;
  canClearFilters: boolean;
  onSelectInstitution: (id: string) => void;
  onFocusCluster: (cluster: PublicMapCluster) => void;
  onClearFilters: () => void;
  onZoomOut: () => void;
};

/**
 * The results region, shared by the desktop split and the mobile sheet.
 *
 * At cluster zoom this is a browsable index rather than a dead end: the very
 * first thing a visitor saw used to be a blue "zoom in to see institutions"
 * hint, because the default view is zoom 7 and the RPC clusters below zoom 12.
 * The clusters the map is already drawing are rendered as rows that fly the map
 * to that group, so the panel says something useful at every zoom.
 */
export function ResultsList({
  mode,
  loading,
  refreshing,
  institutionRows,
  clusterRows,
  selectedId,
  canClearFilters,
  onSelectInstitution,
  onFocusCluster,
  onClearFilters,
  onZoomOut,
}: ResultsListProps) {
  const t = useT();

  if (loading) {
    return (
      <div className="space-y-3">
        <InstitutionCardSkeleton />
        <InstitutionCardSkeleton />
        <InstitutionCardSkeleton />
      </div>
    );
  }

  const rowCount = mode === "clusters" ? clusterRows.length : institutionRows.length;

  if (rowCount === 0) {
    return (
      <EmptyState
        icon={<SearchX className="h-8 w-8" aria-hidden />}
        title={t("map_page.empty")}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {canClearFilters ? (
              <Button variant="secondary" size="sm" onClick={onClearFilters}>
                {t("needs_page.clear_filters")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              icon={<ZoomOut className="h-4 w-4" aria-hidden />}
              onClick={onZoomOut}
            >
              {t("map_ui.zoom_out")}
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div
      className={clsx(
        "transition-opacity duration-150 ease-out",
        refreshing && "opacity-60"
      )}
    >
      {mode === "clusters" ? (
        <>
          <p className="mb-3 text-xs leading-relaxed text-ink-tertiary">
            {t("map_page.cluster_hint")}
          </p>
          <ul className="flex flex-col gap-2">
            {clusterRows.map(({ cluster, distance }) => (
              <li key={cluster.id}>
                <ClusterRowButton
                  cluster={cluster}
                  distance={distance}
                  onActivate={() => onFocusCluster(cluster)}
                />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="flex flex-col gap-3">
          {institutionRows.map(({ institution, distance }) => (
            <li key={institution.id}>
              <InstitutionCard
                institution={institution}
                isSelected={institution.id === selectedId}
                onClick={() => onSelectInstitution(institution.id)}
                distanceKm={distance}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Deliberately shaped like the cluster pin it stands for — same brand fill,
 * same count, and the urgency flag spelled out as a badge instead of the
 * unexplained blue→red hue swap the markers used to rely on.
 */
function ClusterRowButton({
  cluster,
  distance,
  onActivate,
}: {
  cluster: PublicMapCluster;
  distance: number | null;
  onActivate: () => void;
}) {
  const t = useT();

  return (
    <button
      type="button"
      onClick={onActivate}
      title={t("map_ui.cluster_title", { count: cluster.count })}
      className={clsx(
        "flex w-full items-center gap-3 rounded-card border border-border-subtle bg-surface-raised p-3 text-left shadow-raised",
        "transition-[box-shadow,transform,border-color] duration-150 ease-out",
        "hover:border-border-strong hover:shadow-overlay motion-safe:active:scale-[0.99]",
        "ring-offset-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      )}
    >
      <span
        aria-hidden
        className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white"
      >
        {cluster.count}
        {cluster.hasUrgentNeed ? (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface-raised bg-warning" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">
          {t("map_ui.cluster_alt", { count: cluster.count })}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
          {distance != null ? (
            <span title={t("map_ui.distance")}>{formatDistance(distance)}</span>
          ) : null}
          {cluster.hasUrgentNeed ? (
            <Badge tone="warning" size="sm">
              {t("need_card.urgent")}
            </Badge>
          ) : null}
        </span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-ink-tertiary" aria-hidden />
    </button>
  );
}
