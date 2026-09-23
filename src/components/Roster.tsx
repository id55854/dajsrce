import type { ReactNode } from "react";
import { Card } from "@/components/ui";

/**
 * The organisation's "who is coming / who promised what" lists, one group per
 * event or need. Shared by the volunteer and pledge tabs so both read the
 * same: a compact header with the fill level, then small name cards in a
 * grid instead of one full-width row per person.
 */
export function RosterGroup({
  title,
  meta,
  count,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  /** The fill level, e.g. "3 / 8 volunteers"; shown as a pill. */
  count: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card padding="none" as="section">
      <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0">
          <h2 className="line-clamp-2 text-base font-semibold leading-snug text-ink">{title}</h2>
          {meta ? <p className="mt-0.5 text-xs text-ink-secondary">{meta}</p> : null}
        </div>
        <span className="shrink-0 rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-semibold tabular-nums text-ink-secondary">
          {count}
        </span>
      </header>
      {children}
    </Card>
  );
}

export function RosterEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-sm text-ink-tertiary">{children}</p>;
}

export function RosterGrid({ children }: { children: ReactNode }) {
  return <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">{children}</ul>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toLocaleUpperCase("hr");
}

export function RosterPerson({
  name,
  email,
  when,
  whenLabel,
  aside,
}: {
  name: string;
  email: string;
  /** ISO timestamp of the signup or pledge. */
  when: string;
  /** Human "2 h ago" text for `when`. */
  whenLabel: string;
  /** Right-hand detail, e.g. the pledged quantity. */
  aside?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-control border border-border-subtle px-3 py-2">
      <span
        aria-hidden
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-on-soft"
      >
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{name}</p>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-tertiary">
          <a
            href={`mailto:${email}`}
            className="truncate text-ink-secondary underline-offset-2 hover:text-brand hover:underline"
          >
            {email}
          </a>
          <span aria-hidden>·</span>
          <time dateTime={when} className="shrink-0">
            {whenLabel}
          </time>
        </p>
      </div>
      {aside ? <div className="shrink-0 text-right">{aside}</div> : null}
    </li>
  );
}
