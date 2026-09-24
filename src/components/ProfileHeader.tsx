import type { ReactNode } from "react";
import { Card } from "@/components/ui";

/**
 * The one header every profile opens with, organisation or individual: who
 * this is, a line of facts, small links on the right, and the profile's main
 * actions underneath. Kept deliberately compact so the calendar and the lists
 * the person actually works with start above the fold.
 */
export function ProfileHeader({
  title,
  facts,
  links,
  actions,
}: {
  title: ReactNode;
  /** Chips and short facts under the name (category, role, email, address). */
  facts?: ReactNode;
  /** Small secondary links, top right. */
  links?: ReactNode;
  /** The profile's primary actions, along the bottom edge. */
  actions?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
          {facts ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-secondary">{facts}</div>
          ) : null}
        </div>
        {links ? <div className="flex shrink-0 flex-wrap gap-2">{links}</div> : null}
      </div>
      {actions ? (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border-subtle pt-4">{actions}</div>
      ) : null}
    </Card>
  );
}

/** A neutral chip for the facts line (role, category fallback). */
export function ProfileChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-semibold text-ink-secondary">
      {children}
    </span>
  );
}
