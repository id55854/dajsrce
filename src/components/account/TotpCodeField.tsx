"use client";

import type { ReactNode, Ref } from "react";
import { Field, Input } from "@/components/ui";
import { useT } from "@/i18n/client";
import { sanitizeTotpInput } from "@/lib/auth/mfa";

/**
 * The six-digit code from an authenticator app, wherever one is asked for:
 * turning two-step sign-in on or off in the settings and the sign-in step on
 * /auth/mfa. `one-time-code` lets a phone offer the code and a password
 * manager fill it; `numeric` brings up the number pad. Pasted spaces and
 * dashes ("123 456") are dropped as they arrive, so there is deliberately no
 * `maxLength`: it would cut such a paste short before it could be cleaned.
 */
export function TotpCodeField({
  value,
  onChange,
  error,
  invalid = false,
  describedByExtra,
  inputRef,
  initialFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Shown under the field; use `invalid` when the message sits in a banner. */
  error?: ReactNode;
  invalid?: boolean;
  /** Id of a form-level banner that also describes this control. */
  describedByExtra?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Where a Dialog puts focus when it opens. */
  initialFocus?: boolean;
}) {
  const t = useT();
  return (
    <Field
      label={t("mfa.code_label")}
      hint={t("mfa.code_hint")}
      error={error}
      required
      requiredLabel={t("common.required")}
    >
      {(field) => (
        <Input
          {...field}
          ref={inputRef}
          aria-describedby={
            [field["aria-describedby"], describedByExtra].filter(Boolean).join(" ") || undefined
          }
          aria-invalid={invalid || field["aria-invalid"]}
          invalid={Boolean(error) || invalid}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          spellCheck={false}
          required
          value={value}
          onChange={(event) => onChange(sanitizeTotpInput(event.target.value))}
          className="font-mono tracking-[0.3em]"
          data-dialog-initial-focus={initialFocus || undefined}
        />
      )}
    </Field>
  );
}
