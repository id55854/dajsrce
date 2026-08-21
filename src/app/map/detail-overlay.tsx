"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Button, usePresence } from "@/components/ui";
import {
  InstitutionDetailPanel,
  InstitutionDetailSkeleton,
} from "@/components/InstitutionDetailPanel";
import { useT } from "@/i18n/client";
import type { AssociationRegistryEntry } from "@/lib/association-registry";
import type { PublicInstitutionDetail } from "@/lib/location-map";
import { RegistryDetailPanel } from "./registry-detail-panel";

/**
 * A pin is either an onboarded institution or a row of the official register,
 * and the two carry different facts from different RPCs. The panel takes the
 * discriminated pair rather than one nullable field per kind, so a stale value
 * of the other kind cannot survive a selection change.
 */
export type MapDetail =
  | { kind: "institution"; institution: PublicInstitutionDetail }
  | { kind: "registry"; organisation: AssociationRegistryEntry };

export function mapDetailName(detail: MapDetail | null): string | null {
  if (!detail) return null;
  return detail.kind === "institution" ? detail.institution.name : detail.organisation.name;
}

export type DetailOverlayProps = {
  open: boolean;
  /**
   * `overlay` slides in over the desktop list, which stays mounted underneath
   * so scroll position and the card the user clicked both survive.
   * `inline` sits in the mobile sheet's own scroll region.
   */
  variant: "overlay" | "inline";
  detail: MapDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
};

/**
 * The institution detail as a real overlay rather than a replacement.
 *
 * It carries the dialog semantics the old inline panel never had — `role`,
 * Escape, focus moved in on open and handed back on close (closing used to drop
 * focus on `<body>`) — and an obvious back control instead of a bare floating X.
 *
 * Both breakpoint variants are mounted at once, because the layout is
 * CSS-driven; the focus and Escape wiring therefore only engages for whichever
 * one is actually visible.
 */
export function DetailOverlay({
  open,
  variant,
  detail,
  loading,
  error,
  onClose,
}: DetailOverlayProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const { present, state, onAnimationEnd } = usePresence(open);
  // Only the desktop overlay outlives `open` for its exit animation. The mobile
  // variant sits in the sheet's flow, so keeping it mounted through an exit
  // would push a fading copy underneath the list that has already come back.
  const isOverlay = variant === "overlay";
  const mounted = isOverlay ? present : open;

  // `mounted` is a dependency on purpose: on the commit where `open` first turns
  // true the node has not rendered yet, so the effect has to run again once it
  // has.
  useEffect(() => {
    if (!open || !mounted) return;
    const node = panelRef.current;
    if (!node || node.offsetParent === null) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    node.focus({ preventScroll: true });
    if (!isOverlay) {
      // The sheet's scroller is shared with the list it replaced, so start the
      // detail at its own top rather than at the list's scroll offset.
      node.scrollIntoView({ block: "start" });
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, [isOverlay, mounted, onClose, open]);

  if (!mounted) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={mapDetailName(detail) ?? t("map_page.loading")}
      tabIndex={-1}
      data-ui-motion
      data-state={state}
      onAnimationEnd={onAnimationEnd}
      className={clsx(
        "flex flex-col outline-none",
        isOverlay
          ? [
              "absolute inset-0 z-10 overflow-hidden bg-surface",
              "data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out",
            ]
          : "data-[state=open]:animate-fade-in"
      )}
    >
      <div
        data-ui-material
        className={clsx(
          "sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-border-subtle bg-chrome py-2 backdrop-blur-xl",
          isOverlay ? "px-2" : "px-0"
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft className="h-4 w-4" aria-hidden />}
          onClick={onClose}
        >
          {t("map_page.back_results")}
        </Button>
      </div>

      <div
        className={clsx(
          "min-h-0",
          isOverlay
            ? "flex-1 overflow-y-auto overscroll-contain p-3"
            : "pb-3 pt-3"
        )}
      >
        {loading ? (
          <InstitutionDetailSkeleton />
        ) : detail?.kind === "institution" ? (
          <InstitutionDetailPanel institution={detail.institution} showCloseButton={false} />
        ) : detail?.kind === "registry" ? (
          <RegistryDetailPanel organisation={detail.organisation} />
        ) : (
          <div
            role="alert"
            className="rounded-card border border-border-subtle bg-danger-soft p-4 text-sm text-danger-on-soft"
          >
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t(error ?? "map_page.detail_error")}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              icon={<ArrowLeft className="h-4 w-4" aria-hidden />}
              onClick={onClose}
            >
              {t("map_page.back_results")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
