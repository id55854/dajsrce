"use client";

import clsx from "clsx";

/**
 * A skeleton earns its place only when its shape predicts the real layout.
 * Prefer composing several of these into a component-specific placeholder over
 * dropping one generic grey block where a rich card will land.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        "animate-pulse rounded-control bg-surface-sunken",
        "motion-reduce:animate-none",
        className
      )}
    />
  );
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={clsx("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={clsx("h-4", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}
