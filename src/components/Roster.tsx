import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Card, Dialog } from "@/components/ui";

export type RosterTone = "brand" | "info" | "success";

/** Static class sets so Tailwind can see every tone it has to generate. */
const TONES: Record<RosterTone, string> = {
  brand: "bg-brand-soft text-brand-on-soft",
  info: "bg-info-soft text-info-on-soft",
  success: "bg-success-soft text-success-on-soft",
};

/** A tinted square holding an icon: the colour says what kind of row it is. */
export function RosterIcon({ tone = "brand", children }: { tone?: RosterTone; children: ReactNode }) {
  return (
    <span aria-hidden className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** A small calendar leaf: day over short month, for dated rows. */
export function RosterDateTile({ day, month, tone = "info" }: { day: string; month: string; tone?: RosterTone }) {
  return (
    <span aria-hidden className={`inline-flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-control leading-none ${TONES[tone]}`}>
      <span className="text-base font-semibold tabular-nums">{day}</span>
      <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide">{month}</span>
    </span>
  );
}

/**
 * The organisation's "who is coming / who promised what" lists, one group per
 * event or need. Shared by the volunteer and pledge tabs so both read the
 * same: a header with the fill level, then a quiet list of people, one row
 * each, separated by hairlines rather than boxed one by one.
 */
export function RosterGroup({
  title,
  icon,
  tone = "brand",
  meta,
  count,
  progress,
  onOpen,
  openLabel,
  children,
}: {
  title: ReactNode;
  /** Header icon, drawn in a tinted circle of `tone`. */
  icon?: ReactNode;
  tone?: RosterTone;
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
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span aria-hidden className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${TONES[tone]}`}>
            {icon}
          </span>
        ) : null}
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
        <dt className="text-xs text-ink-tertiary">{label}</dt>
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

/**
 * A generic row in the same list: an event, a need, a pledge. Same rhythm as
 * RosterPerson so a profile's lists read alike whatever they hold.
 */
export function RosterItem({
  id,
  leading,
  title,
  subtitle,
  detail,
  aside,
  action,
  onOpen,
  flush = false,
}: {
  id?: string;
  /**
   * Opens the row's details. Only the icon and text become the button, so a
   * trailing action such as withdraw is never triggered by opening.
   */
  onOpen?: () => void;
  /** A RosterIcon or RosterDateTile before the text. */
  leading?: ReactNode;
  title: ReactNode;
  /** Who or where, e.g. the organisation. */
  subtitle?: ReactNode;
  /** When, e.g. "prije 2 dana" or the event date. */
  detail?: ReactNode;
  /** Right-hand figure, e.g. the pledged quantity. */
  aside?: ReactNode;
  /** A trailing control, e.g. withdraw. */
  action?: ReactNode;
  /** Drop the side padding when the list already sits inside padding. */
  flush?: boolean;
}) {
  return (
    <li
      id={id}
      className={`group flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 transition-colors hover:bg-surface-sunken/60 sm:flex-nowrap ${flush ? "" : "px-4"}`}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {leading}
          <ItemText title={title} subtitle={subtitle} detail={detail} interactive />
        </button>
      ) : (
        <>
          {leading}
          <ItemText title={title} subtitle={subtitle} detail={detail} />
        </>
      )}
      {aside ? <div className="w-16 shrink-0 text-right">{aside}</div> : null}
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

function ItemText({ title, subtitle, detail, interactive = false }: {
  title: ReactNode;
  subtitle?: ReactNode;
  detail?: ReactNode;
  interactive?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className={`line-clamp-2 text-sm font-medium text-ink ${interactive ? "group-hover:text-brand" : ""}`}>{title}</p>
      {subtitle ? <p className="truncate text-xs text-ink-secondary">{subtitle}</p> : null}
      {detail ? <p className="text-xs text-ink-tertiary">{detail}</p> : null}
    </div>
  );
}

/** The quantity figure used on the right of pledge rows. */
export function RosterQuantity({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <>
      <p className="text-base font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-xs text-ink-tertiary">{label}</p>
    </>
  );
}

/**
 * A person in a roster: just the name, and a click for the rest. Email,
 * dates and counts live in RosterPersonDialog, so the list stays a quiet
 * column of names.
 */
export function RosterPerson({
  name,
  onOpen,
  aside,
}: {
  name: string;
  onOpen: () => void;
  /** Right-hand figure, e.g. the pledged quantity. */
  aside?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-sunken/60">
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className="min-w-0 flex-1 truncate rounded-control text-left text-sm font-medium text-ink hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {name}
      </button>
      {aside ? <div className="shrink-0 text-right">{aside}</div> : null}
    </li>
  );
}

export type RosterPersonDetails = {
  name: string;
  email: string;
  /** Standing pledges and active signups with this organisation. */
  pledges: number;
  signups: number;
  /** "Prijava prije 2 sata" or similar, for the row they were opened from. */
  since?: string;
};

/** A small card of who someone is, opened from their name. */
export function RosterPersonDialog({
  person,
  onClose,
  labels,
}: {
  person: RosterPersonDetails | null;
  onClose: () => void;
  labels: { close: string; email: string; pledges: string; signups: string };
}) {
  if (!person) return null;
  return (
    <Dialog open onClose={onClose} title={person.name} description={person.since} closeLabel={labels.close}>
      <dl className="space-y-3 text-sm">
        {person.email ? (
          <div>
            <dt className="text-xs text-ink-tertiary">{labels.email}</dt>
            <dd>
              <a href={`mailto:${person.email}`} className="break-all text-brand underline-offset-2 hover:underline">
                {person.email}
              </a>
            </dd>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-control bg-brand-soft px-3 py-2 text-brand-on-soft">
            <dd className="text-xl font-semibold tabular-nums">{person.pledges}</dd>
            <dt className="text-xs">{labels.pledges}</dt>
          </div>
          <div className="rounded-control bg-info-soft px-3 py-2 text-info-on-soft">
            <dd className="text-xl font-semibold tabular-nums">{person.signups}</dd>
            <dt className="text-xs">{labels.signups}</dt>
          </div>
        </div>
      </dl>
    </Dialog>
  );
}
