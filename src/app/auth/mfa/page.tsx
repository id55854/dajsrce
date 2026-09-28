"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { TotpCodeField } from "@/components/account/TotpCodeField";
import { useT } from "@/i18n/client";
import { mfaErrorKey, mfaNextPath, normalizeTotpCode } from "@/lib/auth/mfa";
import { ORGANISATION } from "@/lib/organisation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { AUTH_NETWORK_ERROR, AUTH_NOT_CONFIGURED } from "../auth-validation";
import { AuthAlert, AuthShell, authLinkClasses } from "../auth-ui";

const FORM_ERROR_ID = "mfa-form-error";

type Stage = "checking" | "ready" | "unavailable";

/**
 * The second step of signing in. The password, Google or an e-mail link has
 * already produced a session, but for an account with an authenticator app
 * that session is `aal1`: the dashboard, the mutation routes and the Data API
 * token all refuse it until the code raises it to `aal2` here. Then the
 * person continues to `next`, which the sign-in had already decided
 * (onboarding, the role's dashboard or the page they asked for).
 */
function MfaChallenge() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = mfaNextPath(searchParams.get("next"));
  const [stage, setStage] = useState<Stage>("checking");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setErrorKey(AUTH_NOT_CONFIGURED);
      setStage("unavailable");
      return;
    }
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;
      if (!level?.currentLevel) {
        router.replace(`/auth/login?next=${encodeURIComponent(next)}`);
        return;
      }
      if (level.currentLevel === "aal2") {
        router.replace(next);
        return;
      }
      // Supabase Auth's answer, not the copy stored with the session.
      const { data: factors, error } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (error || !factors) {
        setErrorKey(mfaErrorKey(error));
        setStage("unavailable");
        return;
      }
      const factor = factors.totp[0];
      if (!factor) {
        // Nothing to confirm: the app was removed (elsewhere, or by an
        // administrator after a lost phone) while this session still listed
        // it. Refreshing stores the current list, or the dashboard guard
        // would send the session straight back here.
        await supabase.auth.refreshSession().catch(() => undefined);
        if (!cancelled) router.replace(next);
        return;
      }
      setFactorId(factor.id);
      setStage("ready");
    })().catch(() => {
      if (cancelled) return;
      setErrorKey(AUTH_NETWORK_ERROR);
      setStage("unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading || !factorId) return;
    const normalized = normalizeTotpCode(code);
    if (!normalized) {
      setErrorKey("mfa.code_format");
      inputRef.current?.focus();
      return;
    }
    setErrorKey(null);
    setLoading(true);
    let failure: string | null = null;
    try {
      const { error } = await createClient().auth.mfa.challengeAndVerify({
        factorId,
        code: normalized,
      });
      if (error) failure = mfaErrorKey(error);
    } catch {
      failure = AUTH_NETWORK_ERROR;
    }
    if (failure) {
      setLoading(false);
      setErrorKey(failure);
      setCode("");
      inputRef.current?.focus();
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      // This browser only: whoever is at the code prompt may not be the
      // account holder, and their other sessions are not this page's to end.
      if (isSupabaseConfigured) await createClient().auth.signOut({ scope: "local" });
    } catch {
      // Leaving for the sign-in page is still the right outcome.
    }
    router.replace("/auth/login");
    router.refresh();
  }

  const signOutFooter = (
    <>
      {t("mfa.challenge_other_account")}{" "}
      <button
        type="button"
        disabled={signingOut}
        onClick={() => void handleSignOut()}
        className={`${authLinkClasses} disabled:opacity-50`}
      >
        {t("mfa.challenge_sign_out")}
      </button>
    </>
  );

  if (stage === "checking") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-gradient-to-b from-brand-soft/60 to-surface px-4 py-12">
        <p role="status" className="inline-flex items-center gap-2 text-base text-ink-secondary">
          <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden="true" />
          {t("mfa.challenge_checking")}
        </p>
      </div>
    );
  }

  if (stage === "unavailable") {
    return (
      <AuthShell title={t("mfa.challenge_unavailable_title")} footer={signOutFooter}>
        <AuthAlert>{t(errorKey ?? "mfa.error_generic")}</AuthAlert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("mfa.challenge_title")}
      subtitle={t("mfa.challenge_subtitle")}
      footer={signOutFooter}
    >
      {/* POST with a same-page action, like the password forms: submitted
          before hydration, a GET would put the code in the address bar. */}
      <form method="post" action="#" onSubmit={handleSubmit} className="space-y-5">
        {errorKey ? <AuthAlert id={FORM_ERROR_ID}>{t(errorKey)}</AuthAlert> : null}
        <TotpCodeField
          value={code}
          onChange={(value) => {
            setCode(value);
            setErrorKey(null);
          }}
          invalid={Boolean(errorKey)}
          describedByExtra={errorKey ? FORM_ERROR_ID : undefined}
          inputRef={inputRef}
        />
        <Button type="submit" size="lg" fullWidth loading={loading}>
          {t("mfa.challenge_submit")}
        </Button>
      </form>
      {ORGANISATION.contactEmail ? (
        <p className="mt-6 text-sm leading-6 text-ink-secondary">
          {t("mfa.lost_device", { email: ORGANISATION.contactEmail })}
        </p>
      ) : null}
    </AuthShell>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <MfaChallenge />
    </Suspense>
  );
}
