"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Chrome } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { useT } from "@/i18n/client";
import { sendPasswordRecovery } from "@/lib/auth/password-recovery";
import { safeInternalPath } from "@/lib/security/redirects";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  AUTH_NETWORK_ERROR,
  AUTH_NOT_CONFIGURED,
  AUTH_RATE_LIMITED,
  authErrorKey,
} from "../auth-validation";
import {
  AuthAlert,
  AuthDivider,
  AuthShell,
  PasswordField,
  authLinkClasses,
  describedBy,
} from "../auth-ui";

const FORM_ERROR_ID = "login-form-error";

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailRef = useRef<HTMLInputElement>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Errors are stored as translation keys, not rendered strings, so switching
  // locale mid-session re-renders them in the new language.
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [credentialError, setCredentialError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const rawNext = searchParams.get("next");
  const next = safeInternalPath(rawNext);
  const nextQuery = rawNext ? `?next=${encodeURIComponent(next)}` : "";

  useEffect(() => {
    if (searchParams.get("error") === "auth_failed") {
      setErrorKey("auth.sign_in_failed");
    }
    if (!isSupabaseConfigured) {
      setErrorKey(AUTH_NOT_CONFIGURED);
      return;
    }
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const target = safeInternalPath(searchParams.get("next"));
      if (data.user) router.replace(target);
    });
  }, [searchParams, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    setCredentialError(false);
    if (!isSupabaseConfigured) {
      setErrorKey(AUTH_NOT_CONFIGURED);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    let failure: string | null = null;
    try {
      const response = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (response.error) failure = authErrorKey(response.error);
    } catch {
      failure = AUTH_NETWORK_ERROR;
    }
    setLoading(false);
    if (failure) {
      setErrorKey(failure);
      setCredentialError(true);
      return;
    }
    router.push(safeInternalPath(searchParams.get("next")));
    router.refresh();
  }

  async function handleRecovery() {
    if (recoveryLoading) return;
    setErrorKey(null);
    setCredentialError(false);
    setSentTo(null);
    const address = email.trim();
    if (!address || !emailRef.current?.checkValidity()) {
      setErrorKey(address ? "auth.error_email_invalid" : "auth.forgot_email_required");
      emailRef.current?.focus();
      return;
    }
    if (!isSupabaseConfigured) { setErrorKey(AUTH_NOT_CONFIGURED); return; }
    setRecoveryLoading(true);
    let failure: string | null = null;
    try {
      const { error } = await sendPasswordRecovery(address, window.location.origin);
      if (error) failure = authErrorKey(error);
    } catch { failure = AUTH_NETWORK_ERROR; }
    setRecoveryLoading(false);
    // A neutral response never reveals whether this address has an account.
    if (failure === AUTH_NETWORK_ERROR || failure === AUTH_RATE_LIMITED) {
      setErrorKey(failure);
    } else { setSentTo(address); }
  }

  async function handleGoogle() {
    setErrorKey(null);
    setCredentialError(false);
    if (!isSupabaseConfigured) {
      setErrorKey(AUTH_NOT_CONFIGURED);
      return;
    }
    setGoogleLoading(true);
    const supabase = createClient();
    let failure: string | null = null;
    try {
      const response = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeInternalPath(searchParams.get("next")))}`,
        },
      });
      if (response.error) failure = authErrorKey(response.error);
    } catch {
      failure = AUTH_NETWORK_ERROR;
    }
    setGoogleLoading(false);
    if (failure) setErrorKey(failure);
  }

  return (
    <AuthShell
      title={t("auth.sign_in_title")}
      subtitle={t("auth.sign_in_subtitle")}
      footer={
        <>
          {t("auth.no_account")}{" "}
          <Link href={`/auth/register${nextQuery}`} className={authLinkClasses}>
            {t("auth.sign_up_link")}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {errorKey ? (
          <AuthAlert id={FORM_ERROR_ID}>{t(errorKey)}</AuthAlert>
        ) : null}

        <Field
          label={t("auth.email_label")}
          required
          requiredLabel={t("common.required")}
        >
          {(field) => (
            <Input
              {...field}
              ref={emailRef}
              aria-describedby={describedBy(
                field["aria-describedby"],
                errorKey ? FORM_ERROR_ID : undefined
              )}
              aria-invalid={credentialError || field["aria-invalid"]}
              name="email"
              type="email"
              autoComplete="email"
              required
              invalid={credentialError}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setSentTo(null); }}
            />
          )}
        </Field>

        <PasswordField
          label={t("auth.password_label")}
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          invalid={credentialError}
          describedByExtra={errorKey ? FORM_ERROR_ID : undefined}
        />

        <div className="flex justify-end">
          <button
            type="button"
            disabled={recoveryLoading || loading}
            onClick={() => void handleRecovery()}
            className={`${authLinkClasses} text-sm disabled:opacity-50`}
          >
            {t(recoveryLoading ? "auth.forgot_sending" : "auth.forgot_password")}
          </button>
        </div>

        {sentTo ? <p role="status" className="rounded-control bg-success-soft p-3 text-sm text-success-on-soft">{t("auth.forgot_sent_body", { email: sentTo })}</p> : null}

        <Button type="submit" size="lg" fullWidth loading={loading} disabled={recoveryLoading}>
          {t("auth.sign_in_cta")}
        </Button>
      </form>

      <AuthDivider label={t("auth.or")} />

      <Button
        variant="secondary"
        size="lg"
        fullWidth
        loading={googleLoading}
        onClick={handleGoogle}
        icon={
          <Chrome className="h-5 w-5 text-brand" strokeWidth={2} aria-hidden="true" />
        }
      >
        {t("auth.continue_with_google")}
      </Button>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
