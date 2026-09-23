"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Near-live pledge and volunteer counts for the cards that show them.
 *
 * One poller per table, shared by every card on the page and stopped when the
 * last card unmounts, so a list of forty events is one request per interval,
 * not forty. It runs only while the tab is visible and catches up as soon as
 * the tab is shown again. The database moved to Neon, which has no Realtime
 * channel; `/api/capacity` returns only the counter columns of these public
 * tables and is CDN-cached for a few seconds, so many viewers share one read.
 */
export type CapacityTable = "needs" | "volunteer_events";

const FIELDS = {
  needs: ["quantity_needed", "quantity_pledged", "is_fulfilled"],
  volunteer_events: ["volunteers_needed", "volunteers_signed_up"],
} as const satisfies Record<CapacityTable, readonly string[]>;

export type CapacityCounts<T extends CapacityTable> = {
  [K in (typeof FIELDS)[T][number]]: K extends "is_fulfilled" ? boolean : K extends "quantity_needed" ? number | null : number;
};

type Row = Record<string, unknown>;
type Listener = (row: Row) => void;

const POLL_INTERVAL_MS = 30_000;
/** The endpoint's own cap; a longer list is read in several requests. */
const IDS_PER_REQUEST = 60;

const listeners: Record<CapacityTable, Map<string, Set<Listener>>> = {
  needs: new Map(),
  volunteer_events: new Map(),
};
const pollers: Partial<Record<CapacityTable, () => void>> = {};

async function poll(table: CapacityTable, signal: AbortSignal) {
  const ids = [...listeners[table].keys()].sort();
  for (let offset = 0; offset < ids.length; offset += IDS_PER_REQUEST) {
    const chunk = ids.slice(offset, offset + IDS_PER_REQUEST);
    const query = new URLSearchParams({ table, ids: chunk.join(",") });
    const response = await fetch(`/api/capacity?${query}`, { signal }).catch(() => null);
    if (!response?.ok || signal.aborted) return;
    const body = (await response.json().catch(() => null)) as { rows?: Row[] } | null;
    for (const row of body?.rows ?? []) {
      if (typeof row.id !== "string") continue;
      listeners[table].get(row.id)?.forEach((listener) => listener(row));
    }
  }
}

function startPoller(table: CapacityTable) {
  if (pollers[table] || typeof document === "undefined") return;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = document.visibilityState === "visible" ? setTimeout(run, POLL_INTERVAL_MS) : null;
  };
  const run = () => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    void poll(table, current.signal).finally(() => {
      if (controller === current) schedule();
    });
  };
  // A tab shown again may have missed several intervals; refresh at once.
  const onVisibility = () => (document.visibilityState === "visible" ? run() : schedule());

  document.addEventListener("visibilitychange", onVisibility);
  schedule();
  pollers[table] = () => {
    document.removeEventListener("visibilitychange", onVisibility);
    if (timer) clearTimeout(timer);
    controller?.abort();
  };
}

function stopPollerIfIdle(table: CapacityTable) {
  const stop = pollers[table];
  if (!stop || listeners[table].size > 0) return;
  delete pollers[table];
  stop();
}

function subscribe(table: CapacityTable, id: string, listener: Listener): () => void {
  const byId = listeners[table];
  const set = byId.get(id) ?? new Set<Listener>();
  set.add(listener);
  byId.set(id, set);
  startPoller(table);
  return () => {
    set.delete(listener);
    if (set.size === 0) byId.delete(id);
    stopPollerIfIdle(table);
  };
}

function pick<T extends CapacityTable>(table: T, row: Row): Partial<CapacityCounts<T>> {
  const counts: Row = {};
  for (const field of FIELDS[table]) {
    const value = row[field];
    if (typeof value === "number" || typeof value === "boolean" || value === null) counts[field] = value;
  }
  return counts as Partial<CapacityCounts<T>>;
}

/**
 * The card's counts, newest first. A live or locally applied value is shown
 * only while the props it overrode are unchanged: when the parent patches or
 * reloads the row, its props are at least as new, and they win again.
 */
export function useLiveCapacity<T extends CapacityTable>(
  table: T,
  id: string,
  base: CapacityCounts<T>
): [CapacityCounts<T>, (counts: Partial<CapacityCounts<T>>) => void] {
  const baseKey = FIELDS[table].map((field) => String(base[field as keyof CapacityCounts<T>])).join("|");
  const baseKeyRef = useRef(baseKey);
  baseKeyRef.current = baseKey;
  const [override, setOverride] = useState<{ baseKey: string; counts: Partial<CapacityCounts<T>> } | null>(null);

  const apply = useCallback((counts: Partial<CapacityCounts<T>>) => {
    setOverride((previous) => ({
      baseKey: baseKeyRef.current,
      counts: {
        ...(previous?.baseKey === baseKeyRef.current ? previous.counts : {}),
        ...counts,
      },
    }));
  }, []);

  useEffect(() => subscribe(table, id, (row) => apply(pick(table, row))), [table, id, apply]);

  const counts = override && override.baseKey === baseKey ? { ...base, ...override.counts } : base;
  return [counts, apply];
}
