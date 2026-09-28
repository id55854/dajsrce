"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, Dialog, buttonClasses, useToast } from "@/components/ui";
import { useT } from "@/i18n/client";
import {
  MFA_SETTINGS_ANCHOR,
  MFA_SETTINGS_HREF,
  TOTP_FRIENDLY_NAME,
  mfaChallengePath,
  mfaErrorKey,
  normalizeTotpCode,
} from "@/lib/auth/mfa";
import { roleToDashboardPath, type AppRole } from "@/lib/auth/roles";
import { ORGANISATION } from "@/lib/organisation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { TotpCodeField } from "./TotpCodeField";

type State =
  | { kind: "checking" }
  | { kind: "unavailable" }
  | { kind: "off" }
  /** A factor enrolled but not yet verified: nothing is enforced until the code is confirmed. */
  | { kind: "enrolling"; factorId: string; qrCode: string; secret: string }
  | { kind: "on"; factorId: string; sessionVerified: boolean };

/**
 * Two-step sign-in in the account settings: turn it on with an authenticator
 * app (TOTP), or off again. Everything goes straight from the browser to
 * Supabase Auth; this component holds no secret beyond the one it shows
 * while the app is being connected.
 *
 * For a superadmin it is mandatory: the administration refuses a session
 * without it, so this section explains that and offers no way to turn it off.
 * (Supabase would allow the removal itself; the administration would then
 * simply stay closed until a new app is connected.)
 */
export function TwoFactorSettings({ role }: { role: AppRole }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const headingId = useId();
  const isAdmin = role === "superadmin";

  const [state, setState] = useState<State>({ kind: "checking" });
  const [busy, setBusy] = useState(false);
  const [formErrorKey, setFormErrorKey] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeErrorKey, setCodeErrorKey] = useState<string | null>(null);
  const [justEnabled, setJustEnabled] = useState(false);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disableNeedsCode, setDisableNeedsCode] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disableErrorKey, setDisableErrorKey] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setState({ kind: "unavailable" });
      return;
    }
    try {
      const supabase = createClient();
      // listFactors() asks Supabase Auth; the assurance level is read from
      // the stored session, which is where it lives.
      const [factors, level] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (factors.error || !factors.data) {
        setState({ kind: "unavailable" });
        return;
      }
      const verified = factors.data.totp[0];
      setState(
        verified
          ? {
              kind: "on",
              factorId: verified.id,
              sessionVerified: level.data?.currentLevel === "aal2",
            }
          : { kind: "off" }
      );
    } catch {
      setState({ kind: "unavailable" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startEnrolment() {
    setBusy(true);
    setFormErrorKey(null);
    try {
      const supabase = createClient();
      const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError || !existing) throw listError ?? new Error("factors unavailable");
      if (existing.totp.length > 0) {
        // Turned on meanwhile, in another tab or on another device.
        await load();
        return;
      }
      // A setup abandoned halfway leaves an unverified factor behind. Nothing
      // else removes it, and a second one under the same name is refused.
      for (const factor of existing.all) {
        if (factor.factor_type === "totp" && factor.status !== "verified") {
          const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
          if (error) throw error;
        }
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: TOTP_FRIENDLY_NAME,
      });
      if (error || !data) throw error ?? new Error("enrolment failed");
      setCode("");
      setCodeErrorKey(null);
      setState({
        kind: "enrolling",
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
    } catch (error) {
      setFormErrorKey(mfaErrorKey(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrolment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind !== "enrolling" || busy) return;
    const normalized = normalizeTotpCode(code);
    if (!normalized) {
      setCodeErrorKey("mfa.code_format");
      return;
    }
    setBusy(true);
    setCodeErrorKey(null);
    try {
      const { error } = await createClient().auth.mfa.challengeAndVerify({
        factorId: state.factorId,
        code: normalized,
      });
      if (error) {
        setCodeErrorKey(mfaErrorKey(error));
        setCode("");
        return;
      }
      // Verifying also raised this session to aal2, which Supabase stored.
      setState({ kind: "on", factorId: state.factorId, sessionVerified: true });
      setCode("");
      setJustEnabled(true);
      toast({ tone: "success", title: t("mfa.enabled_toast") });
      router.refresh();
    } catch (error) {
      setCodeErrorKey(mfaErrorKey(error));
    } finally {
      setBusy(false);
    }
  }

  async function cancelEnrolment() {
    if (state.kind !== "enrolling") return;
    const { factorId } = state;
    setState({ kind: "off" });
    setCode("");
    setCodeErrorKey(null);
    try {
      await createClient().auth.mfa.unenroll({ factorId });
    } catch {
      // The next attempt removes it anyway.
    }
  }

  function openDisable() {
    if (state.kind !== "on" || isAdmin) return;
    setDisableCode("");
    setDisableErrorKey(null);
    // Supabase removes a verified factor only for an aal2 session.
    setDisableNeedsCode(!state.sessionVerified);
    setDisableOpen(true);
  }

  async function confirmDisable() {
    if (state.kind !== "on" || isAdmin || disabling) return;
    const { factorId } = state;
    setDisableErrorKey(null);
    let normalized: string | null = null;
    if (disableNeedsCode) {
      normalized = normalizeTotpCode(disableCode);
      if (!normalized) {
        setDisableErrorKey("mfa.code_format");
        return;
      }
    }
    setDisabling(true);
    try {
      const supabase = createClient();
      if (normalized) {
        const verified = await supabase.auth.mfa.challengeAndVerify({ factorId, code: normalized });
        if (verified.error) {
          setDisableErrorKey(mfaErrorKey(verified.error));
          setDisableCode("");
          return;
        }
        // The session is aal2 now; a retry after a failed removal needs no new code.
        setDisableNeedsCode(false);
      }
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) {
        if ((error as { code?: string }).code === "insufficient_aal") {
          setDisableNeedsCode(true);
          setDisableCode("");
          return;
        }
        setDisableErrorKey(mfaErrorKey(error));
        return;
      }
      // Supabase has lowered this session to aal1; a refresh stores that,
      // and the factor list without the removed app, in the session.
      await supabase.auth.refreshSession().catch(() => undefined);
      setDisableOpen(false);
      setState({ kind: "off" });
      setJustEnabled(false);
      toast({ tone: "success", title: t("mfa.disabled_toast") });
      router.refresh();
    } catch (error) {
      setDisableErrorKey(mfaErrorKey(error));
    } finally {
      setDisabling(false);
    }
  }

  const contactEmail = ORGANISATION.contactEmail;
  const statusBadge =
    state.kind === "on" ? (
      <Badge tone="success">{t("mfa.status_on")}</Badge>
    ) : state.kind === "off" || state.kind === "enrolling" ? (
      <Badge tone="neutral">{t("mfa.status_off")}</Badge>
    ) : null;

  return (
    <Card
      as="section"
      padding="lg"
      id={MFA_SETTINGS_ANCHOR}
      aria-labelledby={headingId}
      className="scroll-mt-24"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold text-ink">
          <ShieldCheck className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
          {t("mfa.settings_title")}
        </h2>
        {statusBadge}
      </div>
      <p className="mt-2 text-base leading-7 text-ink-secondary">{t("mfa.settings_intro")}</p>

      {isAdmin && state.kind !== "on" ? (
        <p className="mt-3 rounded-control border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm text-warning-on-soft">
          {t("mfa.admin_required")}
        </p>
      ) : null}

      {formErrorKey ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {t(formErrorKey)}
        </p>
      ) : null}

      {state.kind === "checking" ? (
        <p role="status" className="mt-4 inline-flex items-center gap-2 text-sm text-ink-secondary">
          <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden="true" />
          {t("mfa.settings_checking")}
        </p>
      ) : null}

      {state.kind === "unavailable" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-ink-secondary">{t("mfa.settings_unavailable")}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setState({ kind: "checking" });
              void load();
            }}
          >
            {t("mfa.retry")}
          </Button>
        </div>
      ) : null}

      {state.kind === "off" ? (
        <div className="mt-4">
          <Button onClick={() => void startEnrolment()} loading={busy}>
            {t("mfa.turn_on")}
          </Button>
        </div>
      ) : null}

      {state.kind === "enrolling" ? (
        <div className="mt-5 space-y-5">
          <div className="space-y-3">
            <p className="text-base text-ink">{t("mfa.enroll_scan")}</p>
            {/* A data: URL Supabase returns with the new factor; there is
                nothing for next/image to optimise. The white tile keeps the
                code scannable in the dark theme. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={state.qrCode}
              alt={t("mfa.enroll_qr_alt")}
              width={192}
              height={192}
              className="h-48 w-48 rounded-control border border-border-subtle bg-white p-2"
            />
            <p className="text-sm text-ink-secondary">{t("mfa.enroll_secret_label")}</p>
            <code className="block select-all break-all rounded-control bg-surface-sunken px-3 py-2 font-mono text-sm text-ink">
              {state.secret}
            </code>
          </div>
          <form method="post" action="#" onSubmit={confirmEnrolment} className="space-y-4">
            <p className="text-base text-ink">{t("mfa.enroll_code_step")}</p>
            <TotpCodeField
              value={code}
              onChange={(next) => {
                setCode(next);
                setCodeErrorKey(null);
              }}
              error={codeErrorKey ? t(codeErrorKey) : undefined}
            />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={busy}>
                {t("mfa.enroll_confirm")}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void cancelEnrolment()}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {state.kind === "on" ? (
        <div className="mt-4 space-y-4">
          <p className="text-base leading-7 text-ink">{t("mfa.on_body")}</p>
          {!state.sessionVerified ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-ink-secondary">{t("mfa.session_unverified")}</p>
              <Link
                href={mfaChallengePath(isAdmin ? roleToDashboardPath(role) : MFA_SETTINGS_HREF)}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                {t("mfa.session_verify")}
              </Link>
            </div>
          ) : null}
          {isAdmin ? (
            <p className="text-sm text-ink-secondary">{t("mfa.admin_locked")}</p>
          ) : (
            <Button variant="secondary" onClick={openDisable}>
              {t("mfa.turn_off")}
            </Button>
          )}
          {isAdmin && justEnabled ? (
            <Link href={roleToDashboardPath(role)} className={buttonClasses()}>
              {t("mfa.admin_continue")}
            </Link>
          ) : null}
          {contactEmail ? (
            <p className="text-sm text-ink-secondary">
              {t("mfa.lost_device", { email: contactEmail })}
            </p>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={disableOpen}
        onClose={() => {
          if (!disabling) setDisableOpen(false);
        }}
        title={t("mfa.disable_title")}
        description={disableNeedsCode ? t("mfa.disable_code_body") : t("mfa.disable_body")}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button
              variant="danger"
              loading={disabling}
              onClick={() => void confirmDisable()}
              data-dialog-initial-focus={disableNeedsCode ? undefined : true}
            >
              {t("mfa.turn_off")}
            </Button>
            <Button variant="secondary" disabled={disabling} onClick={() => setDisableOpen(false)}>
              {t("common.cancel")}
            </Button>
          </>
        }
      >
        {disableNeedsCode ? (
          <form
            method="post"
            action="#"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmDisable();
            }}
          >
            <TotpCodeField
              value={disableCode}
              onChange={(next) => {
                setDisableCode(next);
                setDisableErrorKey(null);
              }}
              error={disableErrorKey ? t(disableErrorKey) : undefined}
              initialFocus
            />
          </form>
        ) : disableErrorKey ? (
          <p role="alert" className="text-sm text-danger">
            {t(disableErrorKey)}
          </p>
        ) : null}
      </Dialog>
    </Card>
  );
}
