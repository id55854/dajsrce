import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
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
  onOpen,
  openLabel,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  /** The fill level, e.g. "3 / 8 volunteers"; shown as a pill. */
  count: ReactNode;
  /** Makes the header open the event's or need's details. */
  onOpen?: () => void;
  /** Visible hint under the meta line when `onOpen` is set. */
  openLabel?: string;
  children: ReactNode;
}) {
  const heading = (
    <>
      <div className="min-w-0">
        <h2 className="line-clamp-2 text-base font-semibold leading-snug text-ink">{title}</h2>
        {meta ? <p className="mt-0.5 text-xs text-ink-secondary">{meta}</p> : null}
        {onOpen && openLabel ? (
          <p className="mt-1 inline-flex items-center gap-0.5 text-xs font-semibold text-brand">
            {openLabel}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </p>
        ) : null}
      </div>
      <span className="shrink-0 rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-semibold tabular-nums text-ink-secondary">
        {count}
      </span>
    </>
  );
  return (
    <Card padding="none" as="section">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          className="flex w-full items-start justify-between gap-3 rounded-t-card border-b border-border-subtle px-4 py-3 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
        >
          {heading}
        </button>
      ) : (
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
          {heading}
        </header>
      )}
      {children}
    </Card>
  );
}

/** One labelled line in a roster details dialog; omitted when empty. */
export function RosterFact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-ink-tertiary">{icon}</span>
      <div className="min-w-0">
        <dt className="sr-only">{label}</dt>
        <dd className="text-ink">{children}</dd>
      </div>
    </div>
  );
}

/** A titled prose block (description, requirements) in a details dialog. */
export function RosterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">{title}</h3>
      <p className="mt-1.5 whitespace-pre-line text-base leading-7 text-ink">{children}</p>
    </section>
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
