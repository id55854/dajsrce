"use client";

import type { ElementType, HTMLAttributes } from "react";
import clsx from "clsx";

export type CardProps = HTMLAttributes<HTMLElement> & {
  /**
   * Element to render. Use a real `article`/`li`/`section` when the card is a
   * semantic unit, rather than putting a `role` on a div.
   */
  as?: ElementType;
  /** Adds hover/press affordance. Only for cards that are actually clickable. */
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
};

const PADDING = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
} as const;

export function Card({
  as: Component = "div",
  interactive = false,
  padding = "md",
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Component
      className={clsx(
        "rounded-card border border-border-subtle bg-surface-raised shadow-raised",
        PADDING[padding],
        interactive && [
          "transition-[box-shadow,transform,border-color] duration-150 ease-out",
          "hover:border-border-strong hover:shadow-overlay",
          "motion-safe:active:scale-[0.99]",
        ],
        className
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
