"use client";

import { useId, useRef } from "react";
import { Button, usePresence } from "@/components/ui";
import { FilterBar } from "@/components/FilterBar";
import { MapPinLegend } from "./pin-legend";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useT } from "@/i18n/client";
import type { MapFilters } from "@/components/Map";

export type MapFilterPanelProps = {
  open: boolean;
  filters: MapFilters;
  onChange: (next: MapFilters) => void;
  onClear: () => void;
  onClose: () => void;
};

/**
 * The mobile filter surface, opened from a control that lives in the sheet
 * header; so filters are reachable at every detent, which is the whole point
 * of the redesign (they used to exist only inside the list view).
 *
 * It is deliberately *not* rendered inside the sheet header itself. The sheet's
 * grab area sets `touch-action: none` to own vertical gestures, and a
 * horizontally scrolling 25-chip row nested under that cannot be panned by
 * touch. A dedicated surface also gives the chips room to wrap instead of
 * hiding two thirds of them off the edge of a 145px peek header.
 */
export function MapFilterPanel({
  open,
  filters,
  onChange,
  onClear,
  onClose,
}: MapFilterPanelProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { present, state, onAnimationEnd } = usePresence(open);
  // Gated on `present` too: on the commit where `open` turns true the panel
  // node has not rendered yet, so the focus trap would find nothing to trap.
  useDialogFocus({ open: open && present, dialogRef: panelRef, onClose });

  if (!present) return null;

  return (
    <div
      data-ui-motion
      data-state={state}
      onAnimationEnd={onAnimationEnd}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="absolute inset-0 z-[var(--z-modal)] flex items-end bg-scrim data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out md:hidden"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-state={state}
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[85%] w-full overflow-y-auto rounded-t-sheet border-t border-border-subtle bg-surface-overlay p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-modal outline-none data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out"
      >
        <h2 id={titleId} className="mb-3 text-base font-semibold text-ink">
          {t("map_page.filters")}
        </h2>

        <FilterBar filters={filters} onChange={onChange} />

        <div className="mt-4">
          <MapPinLegend />
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="md" fullWidth onClick={onClear}>
            {t("needs_page.clear_filters")}
          </Button>
          <Button variant="primary" size="md" fullWidth onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
