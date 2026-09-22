"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui";
import { useT } from "@/i18n/client";
import { sendPasswordRecovery } from "@/lib/auth/password-recovery";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { AUTH_NETWORK_ERROR, AUTH_NOT_CONFIGURED, authErrorKey } from "../auth-validation";
import { AuthAlert, AuthShell, authLinkClasses } from "../auth-ui";

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const savedEmail = sessionStorage.getItem("password-recovery-email");
      if (savedEmail !== null) setEmail(savedEmail);
      sessionStorage.removeItem("password-recovery-email");
    } catch { /* The user can enter their email when storage is unavailable. */ }
  }, []);

  async function send(address: string) {
    if (loading) return;
    setError(null);
    if (!isSupabaseConfigured) { setError(AUTH_NOT_CONFIGURED); return; }
    setLoading(true);
    try {
      const { error: failure } = await sendPasswordRecovery(address, window.location.origin);
      if (failure) { setError(authErrorKey(failure)); return; }
      // Supabase returns the same result for unknown accounts.
      setSentTo(address);
    } catch { setError(AUTH_NETWORK_ERROR); }
    finally { setLoading(false); }
  }

  return (
    <AuthShell
      title={t(sentTo ? "auth.forgot_sent_title" : "auth.forgot_title")}
      subtitle={sentTo ? undefined : t("auth.forgot_subtitle")}
      footer={<Link href="/auth/login" className={authLinkClasses}>{t("auth.back_to_sign_in")}</Link>}
    >
      <div className="space-y-5">
        {error ? <AuthAlert id="recovery-error">{t(error)}</AuthAlert> : null}
        {sentTo ? (
          <>
            <AuthAlert tone="success">{t("auth.forgot_sent_body", { email: sentTo })}</AuthAlert>
            <Button fullWidth size="lg" loading={loading} onClick={() => void send(sentTo)}>
              {t(loading ? "auth.forgot_sending" : "auth.forgot_resend")}
            </Button>
            <Button fullWidth variant="secondary" disabled={loading} onClick={() => { setSentTo(null); setError(null); }}>
              {t("auth.forgot_change_email")}
            </Button>
          </>
        ) : (
          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void send(email.trim()); }}>
            <Field label={t("auth.email_label")} required requiredLabel={t("common.required")}>
              {(field) => <Input {...field} name="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby={error ? "recovery-error" : field["aria-describedby"]} />}
            </Field>
            <Button type="submit" fullWidth size="lg" loading={loading}>
              {t(loading ? "auth.forgot_sending" : "auth.forgot_submit")}
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
