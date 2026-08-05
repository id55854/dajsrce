"use client";

import type { ReactNode } from "react";
import clsx from "clsx";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-ink-secondary",
  brand: "bg-brand-soft text-brand-on-soft",
  success: "bg-success-soft text-success-on-soft",
  warning: "bg-warning-soft text-warning-on-soft",
  danger: "bg-danger-soft text-danger-on-soft",
  info: "bg-info-soft text-info-on-soft",
};

export function Badge({
  tone = "neutral",
  size = "md",
  icon,
  className,
  children,
}: {
  tone?: BadgeTone;
  size?: "sm" | "md";
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-semibold",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
        TONES[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}
