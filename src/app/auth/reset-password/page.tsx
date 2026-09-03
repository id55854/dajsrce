"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button, buttonClasses, useToast } from "@/components/ui";
import { useT } from "@/i18n/client";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { evaluatePassword } from "@/lib/password-strength";
import {
  AUTH_NETWORK_ERROR,
  AUTH_NOT_CONFIGURED,
  MIN_PASSWORD_LENGTH,
  authErrorKey,
} from "../auth-validation";
import {
  AuthAlert,
  AuthShell,
  PasswordField,
  authLinkClasses,
} from "../auth-ui";

const FORM_ERROR_ID = "reset-form-error";

type Stage = "checking" | "ready" | "invalid" | "done";

export default function ResetPasswordPage() {
  const t = useT();
  const toast = useToast();
  const [stage, setStage] = useState<Stage>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  // There is no email field on this form, so the recovery session supplies the
  // address the deny-list needs. It never leaves the browser.
  const [accountEmail, setAccountEmail] = useState("");
  const [formErrorKey, setFormErrorKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setFormErrorKey(AUTH_NOT_CONFIGURED);
      setStage("invalid");
      return;
    }

    const supabase = createClient();
    let active = true;

    // `/auth/callback` normally establishes the recovery session before this
    // page renders, so `getSession` resolves it straight from the cookie. The
    // listener is the fallback for a link that lands here directly and lets the
    // browser client finish its own code exchange.
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active || !session) return;
        setAccountEmail(session.user.email ?? "");
        setStage("ready");
      }
    );

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setAccountEmail(data.session?.user.email ?? "");
      setStage(data.session ? "ready" : "invalid");
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const strength = useMemo(
    () =>
      evaluatePassword(password, {
        minLength: MIN_PASSWORD_LENGTH,
        email: accountEmail,
      }),
    [password, accountEmail]
  );

  const mismatch = confirmation.length > 0 && confirmation !== password;

  const confirmationError =
    confirmationTouched && mismatch ? "auth.reset_mismatch" : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormErrorKey(null);

    // Hard rules only, surfaced through the strength meter next to the
    // field, never spelled out here. The score alone is advice, not a gate.
    if (strength.rejectionKey) return;
    if (confirmation !== password) {
      setConfirmationTouched(true);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    let failure: string | null = null;
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) failure = authErrorKey(error);
    } catch {
      failure = AUTH_NETWORK_ERROR;
    }
    setLoading(false);

    if (failure) {
      setFormErrorKey(failure);
      return;
    }

    toast({ tone: "success", title: t("auth.reset_done_toast") });
    setStage("done");
  }

  if (stage === "checking") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-gradient-to-b from-brand-soft/60 to-surface px-4 py-12">
        <p
          role="status"
          className="inline-flex items-center gap-2 text-base text-ink-secondary"
        >
          <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden="true" />
          {t("auth.reset_checking")}
        </p>
      </div>
    );
  }

  if (stage === "invalid") {
    return (
      <AuthShell
        title={t("auth.reset_invalid_title")}
        footer={
          <Link href="/auth/login" className={authLinkClasses}>
            {t("auth.back_to_sign_in")}
          </Link>
        }
      >
        <div className="space-y-5">
          <AuthAlert>
            {formErrorKey ? t(formErrorKey) : t("auth.reset_invalid_body")}
          </AuthAlert>
          <Link
            href="/auth/forgot-password"
            className={buttonClasses({ size: "lg", fullWidth: true })}
          >
            {t("auth.reset_request_new")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (stage === "done") {
    return (
      <AuthShell title={t("auth.reset_done_title")}>
        <div className="space-y-5">
          <AuthAlert tone="success">{t("auth.reset_done_body")}</AuthAlert>
          <Link
            href="/dashboard"
            className={buttonClasses({ size: "lg", fullWidth: true })}
          >
            {t("auth.go_to_dashboard")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.reset_title")}
      subtitle={t("auth.reset_subtitle")}
      footer={
        <Link href="/auth/login" className={authLinkClasses}>
          {t("auth.back_to_sign_in")}
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {formErrorKey ? (
          <AuthAlert id={FORM_ERROR_ID}>{t(formErrorKey)}</AuthAlert>
        ) : null}

        <PasswordField
          label={t("auth.reset_new_password_label", {
            min: MIN_PASSWORD_LENGTH,
          })}
          name="new-password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={setPassword}
          describedByExtra={formErrorKey ? FORM_ERROR_ID : undefined}
          strength={password.length > 0 ? strength : null}
        />

        <PasswordField
          label={t("auth.reset_confirm_label")}
          name="confirm-password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={confirmation}
          onChange={setConfirmation}
          onBlur={() => setConfirmationTouched(true)}
          error={confirmationError ? t(confirmationError) : undefined}
        />

        <Button type="submit" size="lg" fullWidth loading={loading}>
          {t("auth.reset_submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
