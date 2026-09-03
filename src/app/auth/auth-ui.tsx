"use client";

import type { ReactNode } from "react";
import { useId, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import clsx from "clsx";
import { Card, Field, Input } from "@/components/ui";
import { useT } from "@/i18n/client";
import {
  PASSWORD_STRENGTH_LEVELS,
  type PasswordScore,
  type PasswordStrength,
} from "@/lib/password-strength";

/**
 * The auth surfaces share one layout: a warm page wash, the page's `h1`,
 * then a single card holding the form and a secondary path below it.
 * Keeping it here means login / register / setup / invite / password reset
 * cannot drift apart again, and the gradient is expressed in tokens so it
 * flips with the theme instead of needing a `dark:` pair.
 */
export function AuthShell({
  title,
  subtitle,
  width = "md",
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  width?: "md" | "lg";
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="bg-gradient-to-b from-brand-soft/60 to-surface px-4 py-12 sm:py-16">
      <div
        className={clsx(
          "mx-auto w-full space-y-6",
          width === "lg" ? "max-w-lg" : "max-w-md"
        )}
      >
        <header className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-3xl font-bold leading-tight tracking-[-0.02em] text-ink sm:text-4xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="max-w-sm text-base leading-7 text-ink-secondary">
              {subtitle}
            </p>
          ) : null}
        </header>

        <Card padding="lg" className="shadow-overlay">
          {children}
        </Card>

        {footer ? (
          <p className="text-center text-base text-ink-secondary">{footer}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Focus recipe for the text links that sit outside the Button primitive. */
export const authLinkClasses =
  "rounded font-semibold text-brand transition-colors hover:text-brand-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

/**
 * Form-level outcome banner. Field-level problems belong inline on the field
 * (see `Field`'s `error` slot); this is for failures that cannot be attributed
 * to one control, such as a rejected credential pair or an unreachable service.
 * Both tones carry an icon so the meaning does not rest on colour alone.
 */
export function AuthAlert({
  id,
  tone = "danger",
  children,
}: {
  id?: string;
  tone?: "danger" | "success";
  children: ReactNode;
}) {
  const success = tone === "success";
  return (
    <div
      id={id}
      role={success ? "status" : "alert"}
      className={clsx(
        "flex items-start gap-2.5 rounded-control border px-3 py-2.5 text-base",
        success
          ? "border-success/30 bg-success-soft text-success-on-soft"
          : "border-danger/30 bg-danger-soft text-danger-on-soft"
      )}
    >
      {success ? (
        <CheckCircle2
          className="mt-0.5 h-5 w-5 shrink-0 text-success"
          aria-hidden="true"
        />
      ) : (
        <AlertCircle
          className="mt-0.5 h-5 w-5 shrink-0 text-danger"
          aria-hidden="true"
        />
      )}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** Joins optional `aria-describedby` ids, collapsing an empty list to undefined. */
export function describedBy(...ids: (string | undefined)[]): string | undefined {
  const present = ids.filter((id): id is string => Boolean(id));
  return present.length > 0 ? present.join(" ") : undefined;
}

/**
 * Colour per band. Colour is never the only signal; the band is also named in
 * words right next to the bar, which is what a colour-blind or screen-reader
 * user actually reads.
 */
const STRENGTH_TONES: Record<PasswordScore, { bar: string; text: string }> = {
  1: { bar: "bg-danger", text: "text-danger" },
  2: { bar: "bg-warning", text: "text-warning-on-soft" },
  3: { bar: "bg-brand", text: "text-brand-strong" },
  4: { bar: "bg-success", text: "text-success-on-soft" },
};

const STRENGTH_SEGMENTS = Array.from(
  { length: PASSWORD_STRENGTH_LEVELS },
  (_, index) => index + 1
);

/**
 * Honest strength readout for a password being *chosen*. The segments are
 * decoration for the sentence below them, not the other way round: the
 * sentence names the band and, while there is a worthwhile improvement left,
 * the one change that would help most.
 *
 * It is a polite live region so a screen-reader user hears the band settle as
 * they type instead of having to hunt for it, and the colour transition is
 * `motion-safe` so a reduced-motion preference gets the same information
 * without the crossfade.
 */
function PasswordStrengthMeter({
  id,
  strength,
}: {
  id: string;
  strength: PasswordStrength;
}) {
  const t = useT();
  const tone = STRENGTH_TONES[strength.score];

  return (
    <div className="space-y-1.5 pt-2">
      <div className="flex gap-1" aria-hidden="true">
        {STRENGTH_SEGMENTS.map((segment) => (
          <span
            key={segment}
            className={clsx(
              "h-1 flex-1 rounded-full",
              "motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out",
              segment <= strength.score ? tone.bar : "bg-border-subtle"
            )}
          />
        ))}
      </div>
      <p id={id} role="status" aria-live="polite" className="text-sm">
        <span className={clsx("font-medium", tone.text)}>
          {t("auth.password_strength_status", {
            level: t(strength.labelKey),
          })}
        </span>
        {strength.hintKey ? (
          <span className="text-ink-secondary"> {t(strength.hintKey)}</span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Password control with the show/hide toggle. Built on `Field` so the label,
 * the inline error and `aria-invalid` are wired structurally rather than per
 * page. The toggle is a bare button rather than `<Button>` on purpose: it has
 * to fill the input's trailing edge, and overriding the primitive's height and
 * padding would put two conflicting utilities on one element. It still carries
 * the primitive's focus ring.
 */
export function PasswordField({
  label,
  value,
  onChange,
  onBlur,
  error,
  invalid = false,
  name,
  autoComplete,
  minLength,
  required = true,
  describedByExtra,
  strength,
}: {
  label: ReactNode;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  error?: ReactNode;
  /**
   * Marks the control invalid when the message lives in a form-level banner
   * instead of under the field; a rejected credential pair cannot be
   * attributed to the password alone.
   */
  invalid?: boolean;
  name: string;
  autoComplete: string;
  minLength?: number;
  required?: boolean;
  /** Id of a form-level banner that also describes this control. */
  describedByExtra?: string;
  /**
   * Shows the strength meter. Only for a password being chosen, sign-in
   * passes nothing, because rating a credential the user already owns would
   * be noise they cannot act on.
   */
  strength?: PasswordStrength | null;
}) {
  const t = useT();
  const uid = useId();
  const [visible, setVisible] = useState(false);
  const strengthId = strength ? `${uid}-strength` : undefined;

  return (
    <Field
      label={label}
      error={error}
      required={required}
      requiredLabel={t("common.required")}
    >
      {(field) => (
        <>
          <div className="relative">
            <Input
              {...field}
              aria-describedby={describedBy(
                field["aria-describedby"],
                describedByExtra,
                strengthId
              )}
              aria-invalid={invalid || field["aria-invalid"]}
              name={name}
              type={visible ? "text" : "password"}
              autoComplete={autoComplete}
              required={required}
              minLength={minLength}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onBlur={onBlur}
              invalid={Boolean(error) || invalid}
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setVisible((previous) => !previous)}
              aria-label={
                visible ? t("auth.hide_password") : t("auth.show_password")
              }
              aria-pressed={visible}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-control text-ink-tertiary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            >
              {visible ? (
                <EyeOff className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Eye className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
          {strength && strengthId ? (
            <PasswordStrengthMeter id={strengthId} strength={strength} />
          ) : null}
        </>
      )}
    </Field>
  );
}

/**
 * Role picker tile, shared by register step 1 and the OAuth setup page; the
 * two screens previously carried byte-similar copies of this markup and had
 * already drifted in their subtitle copy.
 */
export function RoleTile({
  icon,
  title,
  subtitle,
  selected,
  onSelect,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  selected: boolean;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        "flex flex-col items-center gap-3 rounded-card border-2 p-6 text-center",
        "transition-[border-color,background-color,box-shadow,transform] duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
        "motion-safe:active:scale-[0.97]",
        selected
          ? "border-brand bg-brand-soft shadow-overlay"
          : "border-border-subtle bg-surface-raised hover:border-border-strong",
        className
      )}
    >
      <span
        className={clsx(
          "transition-colors",
          selected ? "text-brand" : "text-ink-tertiary"
        )}
      >
        {icon}
      </span>
      <span className="text-base font-semibold text-ink">{title}</span>
      <span className="text-sm text-ink-secondary">{subtitle}</span>
    </button>
  );
}

/** The "or" rule between the credential form and the OAuth button. */
export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="relative my-8">
      <div aria-hidden="true" className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-border-subtle" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-surface-raised px-3 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
          {label}
        </span>
      </div>
    </div>
  );
}
