"use client";

import { AlertTriangle, Loader2, RefreshCw, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { PublicMapResponse } from "@/lib/location-map";

export function ResultsMeta({
  loading,
  refreshing,
  mode,
  totalMatches,
  listCount,
  showTruncation,
  searchActive,
  locale,
  onZoomIn,
}: {
  loading: boolean;
  refreshing: boolean;
  mode: PublicMapResponse["meta"]["mode"];
  totalMatches: number;
  listCount: number;
  showTruncation: boolean;
  searchActive: boolean;
  locale: string;
  onZoomIn: () => void;
}) {
  const t = useT();
  const count = totalMatches.toLocaleString(locale);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs text-ink-secondary">
        <p aria-live="polite" className="min-w-0 truncate">
          {loading
            ? t("map_page.loading")
            : searchActive
              ? t("map_page.search_count", { count })
              : mode === "clusters"
              ? t("map_page.clusters_count", { count })
              : t("map_page.area_count", { count })}
        </p>
        {refreshing ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        ) : null}
      </div>

      {showTruncation ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control bg-warning-soft px-2.5 py-2 text-xs text-warning-on-soft">
          <span className="font-semibold">
            {listCount.toLocaleString(locale)} / {count}
          </span>
          <span className="min-w-0 flex-1">{t("map_page.bounded")}</span>
          <button
            type="button"
            onClick={onZoomIn}
            // This notice also renders inside the sheet's grab area; a press on
            // a control there must not become a drag.
            onPointerDown={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-full px-1 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <ZoomIn className="h-3.5 w-3.5" aria-hidden />
            {t("map_ui.zoom_in")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function LoadErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className="mb-3 rounded-card border border-border-subtle bg-warning-soft p-3 text-sm text-warning-on-soft"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{t(message)}</p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="mt-2"
        icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        onClick={onRetry}
      >
        {t("map_page.retry")}
      </Button>
    </div>
  );
}
