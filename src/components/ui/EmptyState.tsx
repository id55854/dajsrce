"use client";

import type { ReactNode } from "react";
import clsx from "clsx";

/**
 * Every empty state should say what happened and offer a way forward — an
 * empty list whose usual cause is an active filter needs a way to clear it.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-border-subtle bg-surface-raised px-6 py-12 text-center",
        className
      )}
    >
      {icon ? <div className="text-ink-tertiary">{icon}</div> : null}
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-ink-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
