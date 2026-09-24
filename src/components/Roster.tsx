import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui";

/**
 * The organisation's "who is coming / who promised what" lists, one group per
 * event or need. Shared by the volunteer and pledge tabs so both read the
 * same: a header with the fill level, then a quiet list of people, one row
 * each, separated by hairlines rather than boxed one by one.
 */
export function RosterGroup({
  title,
  meta,
  count,
  progress,
  onOpen,
  openLabel,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  /** The fill level, e.g. "3 / 8 volunteers"; shown as a pill. */
  count: ReactNode;
  /** 0-100 fill for the thin bar under the header; omitted without a target. */
  progress?: number | null;
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
    <Card padding="none" as="section" className="overflow-hidden">
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
      {progress != null ? (
        <div className="h-1 bg-surface-sunken" aria-hidden>
          <div className="h-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      ) : null}
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

export function RosterList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border-subtle">{children}</ul>;
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
  note,
  aside,
}: {
  name: string;
  email: string;
  /** ISO timestamp of the (latest) signup or pledge. */
  when: string;
  /** Human "prije 2 sata" text for `when`. */
  whenLabel: string;
  /** Extra detail after the time, e.g. "2 obećanja". */
  note?: ReactNode;
  /** Right-hand figure, e.g. the pledged quantity. */
  aside?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-sunken/60">
      <span
        aria-hidden
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-on-soft"
      >
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{name}</p>
        {email ? (
          <a
            href={`mailto:${email}`}
            title={email}
            className="block truncate text-xs text-ink-secondary underline-offset-2 hover:text-brand hover:underline"
          >
            {email}
          </a>
        ) : null}
        <p className="text-xs text-ink-tertiary sm:hidden">
          <time dateTime={when}>{whenLabel}</time>
          {note ? <> · {note}</> : null}
        </p>
      </div>
      <div className="hidden shrink-0 text-right text-xs text-ink-tertiary sm:block">
        <time dateTime={when}>{whenLabel}</time>
        {note ? <p>{note}</p> : null}
      </div>
      {aside ? <div className="w-16 shrink-0 text-right">{aside}</div> : null}
    </li>
  );
}
