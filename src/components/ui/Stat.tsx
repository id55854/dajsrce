import type { ReactNode } from "react";
import clsx from "clsx";

/**
 * Replaces the four divergent stat-card implementations across the dashboards.
 *
 * `value` accepts a node so a surface with no data yet can render an honest
 * em-dash instead of a hardcoded zero that reads as a real measurement.
 */
export function Stat({
  label,
  value,
  hint,
  icon,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "brand" | "success" | "muted";
  className?: string;
}) {
  const valueTone = {
    default: "text-ink",
    brand: "text-brand",
    success: "text-success",
    muted: "text-ink-tertiary",
  }[tone];

  return (
    <div
      className={clsx(
        "rounded-card border border-border-subtle bg-surface-raised p-5 shadow-raised",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
          {label}
        </p>
        {icon ? <span className="text-ink-tertiary">{icon}</span> : null}
      </div>
      <p className={clsx("mt-2 text-3xl font-bold tabular-nums", valueTone)}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-sm text-ink-secondary">{hint}</p> : null}
    </div>
  );
}
