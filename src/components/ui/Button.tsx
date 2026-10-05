"use client";

import { Children, type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button-classes";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Shows a spinner and blocks interaction without changing the label. */
  loading?: boolean;
  /** Rendered before the label; hidden while `loading`. */
  icon?: ReactNode;
};

/**
 * True when the label is only text (a string, a number or several of them),
 * so it can sit in one truncating span. Anything else, an icon passed as a
 * child for instance, is left as separate flex items to keep the gap.
 */
function isTextLabel(children: ReactNode): boolean {
  const parts = Children.toArray(children);
  return parts.length > 0 && parts.every((part) => typeof part === "string" || typeof part === "number");
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const textLabel = isTextLabel(children);
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({
        variant,
        size,
        fullWidth,
        // A text label truncates, so the button may be capped at its
        // container's width instead of pushing past it.
        className: textLabel ? clsx("max-w-full", className) : className,
      })}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        icon
      )}
      {textLabel ? <span className="min-w-0 truncate">{children}</span> : children}
    </button>
  );
}
