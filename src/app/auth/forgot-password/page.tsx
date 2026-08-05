"use client";

import { useState } from "react";
import Link from "next/link";
import { Field, Input, Button, useToast } from "@/components/ui";
import { useT } from "@/i18n/client";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  AUTH_NETWORK_ERROR,
  AUTH_NOT_CONFIGURED,
  AUTH_RATE_LIMITED,
  authErrorKey,
} from "../auth-validation";
import { AuthAlert, AuthShell, authLinkClasses } from "../auth-ui";

const FORM_ERROR_ID = "forgot-form-error";

/**
 * The recovery mail redirects through the existing `/auth/callback` route
 * rather than straight at the update page: that route already exchanges the
 * code for a session, and it is a redirect target Supabase is configured to
 * allow, so the reset flow needs no new auth handling of its own.
 */
function recoveryRedirectTarget(): string {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent("/auth/reset-password")}`;
}

export default function ForgotPasswordPage() {
  const t = useT();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [emailErrorKey, setEmailErrorKey] = useState<string | null>(null);
  const [formErrorKey, setFormErrorKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestReset(address: string) {
    setFormErrorKey(null);

    if (!isSupabaseConfigured) {
      setFormErrorKey(AUTH_NOT_CONFIGURED);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    let failure: string | null = null;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: recoveryRedirectTarget(),
      });
      if (error) failure = authErrorKey(error);
    } catch {
      failure = AUTH_NETWORK_ERROR;
    }
    setLoading(false);

    // Only surface failures that say nothing about the account: we cannot
    // reach the service, or the caller is being throttled. Everything else
    // resolves to the same neutral confirmation, so this page never reveals
    // whether an address is registered.
    if (failure === AUTH_NETWORK_ERROR || failure === AUTH_RATE_LIMITED) {
      setFormErrorKey(failure);
      return;
    }

    setSentTo(address);
    setSent(true);
    toast({ tone: "success", title: t("auth.forgot_sent_toast") });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEmailErrorKey(null);
    const address = email.trim();
    if (!address) {
      setEmailErrorKey("auth.forgot_email_required");
      return;
    }
    await requestReset(address);
  }

  const backToSignIn = (
    <Link href="/auth/login" className={authLinkClasses}>
      {t("auth.back_to_sign_in")}
    </Link>
  );

  if (sent) {
    return (
      <AuthShell title={t("auth.forgot_sent_title")} footer={backToSignIn}>
        <div className="space-y-5">
          {formErrorKey ? <AuthAlert>{t(formErrorKey)}</AuthAlert> : null}
          <p className="text-base leading-7 text-ink-secondary">
            {t("auth.forgot_sent_body", { email: sentTo })}
          </p>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            loading={loading}
            onClick={() => void requestReset(sentTo)}
          >
            {t("auth.forgot_resend")}
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.forgot_title")}
      subtitle={t("auth.forgot_subtitle")}
      footer={backToSignIn}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {formErrorKey ? (
          <AuthAlert id={FORM_ERROR_ID}>{t(formErrorKey)}</AuthAlert>
        ) : null}

        <Field
          label={t("auth.email_label")}
          required
          requiredLabel={t("common.required")}
          error={emailErrorKey ? t(emailErrorKey) : undefined}
        >
          {(field) => (
            <Input
              {...field}
              name="email"
              type="email"
              autoComplete="email"
              required
              invalid={Boolean(emailErrorKey)}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>

        <Button type="submit" size="lg" fullWidth loading={loading}>
          {t("auth.forgot_submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
