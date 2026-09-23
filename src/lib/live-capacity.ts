"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Live pledge and volunteer counts for the cards that show them.
 *
 * One Realtime channel per table, shared by every card on the page and closed
 * when the last card unmounts, so a list of forty events is one subscription,
 * not forty. Only the counter columns are read from the change payload; both
 * tables are public (`... are viewable by everyone`), so the payload carries
 * nothing the public API does not already return.
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

const listeners: Record<CapacityTable, Map<string, Set<Listener>>> = {
  needs: new Map(),
  volunteer_events: new Map(),
};
const channels: Partial<Record<CapacityTable, RealtimeChannel>> = {};

function openChannel(table: CapacityTable) {
  if (channels[table] || !isSupabaseConfigured) return;
  channels[table] = createClient()
    .channel(`capacity:${table}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table }, (payload) => {
      const row = payload.new as Row;
      if (typeof row.id !== "string") return;
      listeners[table].get(row.id)?.forEach((listener) => listener(row));
    })
    .subscribe();
}

function closeChannelIfIdle(table: CapacityTable) {
  const channel = channels[table];
  if (!channel || listeners[table].size > 0) return;
  delete channels[table];
  void createClient().removeChannel(channel);
}

function subscribe(table: CapacityTable, id: string, listener: Listener): () => void {
  const byId = listeners[table];
  const set = byId.get(id) ?? new Set<Listener>();
  set.add(listener);
  byId.set(id, set);
  openChannel(table);
  return () => {
    set.delete(listener);
    if (set.size === 0) byId.delete(id);
    closeChannelIfIdle(table);
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
