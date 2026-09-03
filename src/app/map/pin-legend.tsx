"use client";

import { Check } from "lucide-react";
import { MAP_PIN_STATUSES, PIN_STATUS_FILL } from "@/lib/location-map";
import { useT } from "@/i18n/client";

/**
 * Explains the pin fills.
 *
 * A colour that encodes "can this organisation actually receive anything" is
 * only useful if the reader is told so. This renders wherever the map's
 * filters render; the desktop aside and the mobile filter panel; because
 * that is where the map's other meaning-carrying controls already are.
 *
 * It imports its colours from `location-map`, not from the Leaflet component,
 * so it costs nothing on first load.
 */
export function MapPinLegend() {
  const t = useT();

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
        {t("map_ui.legend_title")}
      </p>
      <ul role="list" className="flex flex-wrap gap-x-4 gap-y-1.5">
        {MAP_PIN_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <span
              aria-hidden
              className="relative inline-flex h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: PIN_STATUS_FILL[status] }}
            >
              {status === "verified" ? (
                <span className="absolute -bottom-1 -right-1 inline-flex h-2.5 w-2.5 items-center justify-center rounded-full bg-success text-white">
                  <Check className="h-1.5 w-1.5" strokeWidth={4} />
                </span>
              ) : null}
            </span>
            {t(`map_ui.status_${status}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
