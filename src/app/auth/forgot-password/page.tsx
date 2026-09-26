"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui";
import { useT } from "@/i18n/client";
import { AUTH_NETWORK_ERROR, AUTH_RATE_LIMITED } from "../auth-validation";
import { AuthAlert, AuthShell, authLinkClasses } from "../auth-ui";

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const savedEmail = sessionStorage.getItem("password-recovery-email");
      if (savedEmail !== null) setEmail(savedEmail);
      sessionStorage.removeItem("password-recovery-email");
    } catch { /* The user can enter their email when storage is unavailable. */ }
  }, []);

  useEffect(() => {
    if (!retryAt) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  async function send(address: string) {
    if (loading || Date.now() < retryAt) return;
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/password-recovery", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address }),
      });
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        setRetryAt(Date.now() + (Number.isFinite(retryAfter) ? retryAfter : 60) * 1000);
        setError(AUTH_RATE_LIMITED);
        return;
      }
      if (!response.ok) {
        setError("auth.forgot_send_failed");
        return;
      }
      setRetryAt(Date.now() + 60_000);
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
            <Button fullWidth size="lg" loading={loading} disabled={remaining > 0} onClick={() => void send(sentTo)}>
              {remaining > 0 ? t("auth.forgot_retry_in", { seconds: remaining }) : t(loading ? "auth.forgot_sending" : "auth.forgot_resend")}
            </Button>
            <Button fullWidth variant="secondary" disabled={loading} onClick={() => { setSentTo(null); setError(null); }}>
              {t("auth.forgot_change_email")}
            </Button>
          </>
        ) : (
          <form method="post" action="#" className="space-y-5" onSubmit={(event) => { event.preventDefault(); void send(email.trim()); }}>
            <Field label={t("auth.email_label")} required requiredLabel={t("common.required")}>
              {(field) => <Input {...field} name="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby={error ? "recovery-error" : field["aria-describedby"]} />}
            </Field>
            <Button type="submit" fullWidth size="lg" loading={loading} disabled={remaining > 0}>
              {remaining > 0 ? t("auth.forgot_retry_in", { seconds: remaining }) : t(loading ? "auth.forgot_sending" : "auth.forgot_submit")}
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
