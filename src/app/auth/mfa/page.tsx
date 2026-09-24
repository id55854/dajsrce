"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { useT } from "@/i18n/client";
import { mfaGateDecision, parseAuthenticatorLevel } from "@/lib/auth/mfa";
import { normalizeRole } from "@/lib/auth/roles";
import { safeInternalPath } from "@/lib/security/redirects";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { AuthAlert, AuthShell, authLinkClasses } from "../auth-ui";

const FORM_ERROR_ID = "mfa-form-error";

type Mode = "loading" | "challenge" | "enroll" | "enabled";

type Factor = { id: string; status: string; factor_type: string };

function qrSvgSrc(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("data:image/svg+xml")) {
    const comma = trimmed.indexOf(",");
    const payload = comma >= 0 ? decodeURIComponent(trimmed.slice(comma + 1)) : "";
    if (/<script/i.test(payload)) return null;
    return trimmed;
  }
  if (!trimmed.startsWith("<svg") || /<script/i.test(trimmed)) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmed)}`;
}

function MfaForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeInternalPath(searchParams.get("next"));
  const [mode, setMode] = useState<Mode>("loading");
  const [required, setRequired] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(
    searchParams.get("error") === "unavailable" ? "auth.mfa_unavailable" : null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setErrorKey("auth.error_not_configured");
      setMode("enroll");
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        router.replace(`/auth/login?next=${encodeURIComponent("/auth/mfa")}`);
        return;
      }

      const [{ data: assurance }, { data: profile }, { data: factors }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.from("profiles").select("role, institution_id").eq("id", user.id).maybeSingle(),
        supabase.auth.mfa.listFactors(),
      ]);
      if (cancelled) return;

      const decision = mfaGateDecision({
        role: normalizeRole(profile?.role),
        hasInstitution: Boolean(profile?.institution_id),
        currentLevel: parseAuthenticatorLevel(assurance?.currentLevel),
        nextLevel: parseAuthenticatorLevel(assurance?.nextLevel),
      });
      setRequired(decision === "enroll" || decision === "challenge");

      const verified = (factors?.totp ?? []).find((factor) => factor.status === "verified");
      if (assurance?.currentLevel === "aal2" && verified) {
        setMode("enabled");
        return;
      }
      if (verified) {
        setFactorId(verified.id);
        setMode("challenge");
        return;
      }

      const stale = ((factors?.all ?? []) as Factor[]).filter(
        (factor) => factor.factor_type === "totp" && factor.status !== "verified"
      );
      for (const factor of stale) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      const enrolled = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "DajSrce",
      });
      if (cancelled) return;
      if (enrolled.error || !enrolled.data) {
        setErrorKey("auth.mfa_unavailable");
        setMode("enroll");
        return;
      }
      setFactorId(enrolled.data.id);
      setSecret(enrolled.data.totp.secret);
      setQrSrc(qrSvgSrc(enrolled.data.totp.qr_code));
      setMode("enroll");
    }

    load().catch(() => {
      if (!cancelled) {
        setErrorKey("auth.mfa_unavailable");
        setMode("enroll");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!factorId || !isSupabaseConfigured) return;
    const trimmed = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(trimmed)) {
      setErrorKey("auth.mfa_error");
      return;
    }
    setLoading(true);
    setErrorKey(null);
    const supabase = createClient();
    const challenged = await supabase.auth.mfa.challenge({ factorId });
    if (challenged.error || !challenged.data) {
      setLoading(false);
      setErrorKey("auth.mfa_error");
      return;
    }
    const verified = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenged.data.id,
      code: trimmed,
    });
    setLoading(false);
    if (verified.error) {
      setErrorKey("auth.mfa_error");
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function handleSignOut() {
    if (isSupabaseConfigured) await createClient().auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  const title =
    mode === "challenge" ? t("auth.mfa_title_challenge") : t("auth.mfa_title_enroll");
  const subtitle =
    mode === "enabled"
      ? t("auth.mfa_enabled")
      : mode === "challenge"
        ? t("auth.mfa_subtitle_challenge")
        : required
          ? t("auth.mfa_subtitle_enroll_required")
          : t("auth.mfa_subtitle_enroll");

  return (
    <AuthShell
      title={mode === "loading" ? t("auth.mfa_title_enroll") : title}
      subtitle={mode === "loading" ? undefined : subtitle}
      footer={
        <button type="button" onClick={handleSignOut} className={authLinkClasses}>
          {t("nav.sign_out")}
        </button>
      }
    >
      {mode === "loading" ? (
        <p className="text-base text-ink-secondary">{t("auth.mfa_loading")}</p>
      ) : null}

      {errorKey ? <AuthAlert id={FORM_ERROR_ID}>{t(errorKey)}</AuthAlert> : null}

      {mode === "enroll" && (qrSrc || secret) ? (
        <div className="mb-5 space-y-4">
          {qrSrc ? (
            // The SVG is produced by Supabase Auth for this enrolment, then
            // checked to be an SVG document before it is shown.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrSrc}
              alt={t("auth.mfa_qr_alt")}
              className="mx-auto h-44 w-44 rounded-control bg-white p-2"
            />
          ) : null}
          {secret ? (
            <p className="text-center text-sm text-ink-secondary">
              <span className="block">{t("auth.mfa_secret_label")}</span>
              <code className="mt-1 block break-all font-mono text-sm text-ink">{secret}</code>
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === "challenge" || mode === "enroll" ? (
        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label={t("auth.mfa_code_label")} required requiredLabel={t("common.required")}>
            {(field) => (
              <Input
                {...field}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={7}
                required
                value={code}
                invalid={errorKey === "auth.mfa_error"}
                onChange={(event) => setCode(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" size="lg" fullWidth loading={loading} disabled={!factorId}>
            {t("auth.mfa_verify")}
          </Button>
          {mode === "enroll" ? (
            <p className="text-sm leading-6 text-ink-secondary">{t("auth.mfa_recovery_note")}</p>
          ) : null}
        </form>
      ) : null}

      {mode === "enabled" ? (
        <Button type="button" size="lg" fullWidth onClick={() => router.push(next)}>
          {t("auth.go_to_dashboard")}
        </Button>
      ) : null}
    </AuthShell>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
