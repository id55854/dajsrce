import type { ReactNode } from "react";
import clsx from "clsx";

const WIDTHS = {
  narrow: "max-w-2xl",
  content: "max-w-4xl",
  wide: "max-w-5xl",
  full: "max-w-7xl",
} as const;

/**
 * The one page container. Replaces the six different max-width/padding recipes
 * the content pages had grown, so vertical rhythm and gutters match wherever
 * the user lands.
 */
export function PageShell({
  width = "full",
  className,
  children,
}: {
  width?: keyof typeof WIDTHS;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "mx-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-8",
        WIDTHS[width],
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * The canonical page title. Large type gets tighter tracking and leading, and
 * one responsive step, so a heading does not read the same at 375px and 1440px.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-3xl font-bold leading-tight tracking-[-0.02em] text-ink sm:text-4xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-3 max-w-3xl text-base leading-7 text-ink-secondary">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

/** Section heading inside a page. Weight carries the step down from `h1`. */
export function SectionHeader({
  id,
  title,
  description,
  actions,
  className,
}: {
  /**
   * Placed on the `h2`, so a wrapping `<section>` can name itself with
   * `aria-labelledby` instead of repeating the title in an `aria-label`.
   */
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx("mb-4 flex items-end justify-between gap-4", className)}
    >
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-ink-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}
