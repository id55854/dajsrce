"use client";

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";
import clsx from "clsx";

/**
 * One focus recipe for every text control in the app. `focus:` rather than
 * `focus-visible:` is deliberate here — a text input should show its ring on
 * click as well as on keyboard entry, because the caret is already there.
 */
export function inputClasses(className?: string, invalid?: boolean): string {
  return clsx(
    "w-full rounded-control border bg-surface-raised px-3 text-ink",
    // 44px tall, matching Button's `md`.
    "h-11 text-base",
    "placeholder:text-ink-tertiary",
    "outline-none transition-[border-color,box-shadow] duration-150 ease-out",
    "disabled:cursor-not-allowed disabled:opacity-60",
    invalid
      ? "border-danger focus:border-danger focus:ring-2 focus:ring-danger/25"
      : "border-border-subtle focus:border-brand focus:ring-2 focus:ring-brand/25",
    className
  );
}

type FieldOwnProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  requiredLabel?: string;
  className?: string;
  /**
   * Receives the wiring a control needs to be described by its own label,
   * hint and error. Spread it onto the input.
   */
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": true | undefined;
    "aria-required": true | undefined;
  }) => ReactNode;
};

/**
 * Label/hint/error shell that guarantees the three things hand-rolled fields
 * in this codebase kept missing: a real `htmlFor`/`id` pair, an error that is
 * programmatically attached to the control, and `aria-invalid`.
 */
export function Field({
  label,
  hint,
  error,
  required,
  requiredLabel,
  className,
  children,
}: FieldOwnProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={clsx("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
        {required && requiredLabel ? (
          <span className="sr-only">{requiredLabel}</span>
        ) : null}
      </label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })}

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-ink-tertiary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={inputClasses(className, invalid)} {...rest} />;
}

export function Textarea({
  className,
  invalid,
  rows = 4,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      rows={rows}
      className={inputClasses(clsx("h-auto py-2.5", className), invalid)}
      {...rest}
    />
  );
}

export function Select({
  className,
  invalid,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={inputClasses(className, invalid)} {...rest}>
      {children}
    </select>
  );
}
