"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Heart, Loader2 } from "lucide-react";
import { Button, buttonClasses, useToast } from "@/components/ui";
import { InstitutionClaimSetup } from "@/components/InstitutionClaimSetup";
import { useT } from "@/i18n/client";
import { richText } from "@/i18n/rich-text";
import { signupRoleFromParams } from "@/lib/auth/onboarding";
import { normalizeRole, roleToDashboardPath } from "@/lib/auth/roles";
import { hasAcceptedCurrentTerms, termsAcceptance } from "@/lib/auth/terms";
import {
  claimConfirmationOutcome,
  takeClaimToken,
  type ClaimConfirmationOutcome,
} from "@/lib/institution-claims";
import { ORGANISATION } from "@/lib/organisation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types";
import {
  AUTH_NOT_AUTHENTICATED,
  AUTH_NOT_CONFIGURED,
  authErrorKey,
} from "../auth-validation";
import { AuthAlert, AuthShell, RoleTile, TermsConsent, authLinkClasses } from "../auth-ui";

const TILE_ICON = "h-10 w-10";

type ClaimConfirmation = {
  outcome: ClaimConfirmationOutcome;
  organisationName: string | null;
};

const CONFIRMATION_MESSAGE: Record<Exclude<ClaimConfirmationOutcome, "confirmed">, string> = {
  invalid: "claims.confirm_invalid",
  closed: "claims.confirm_closed",
  unavailable: "claims.confirm_unavailable",
};

/**
 * Consume a mailbox-challenge token. The confirmation needs no session: the
 * link usually arrives in the association's official mailbox, which is often
 * read on another device or by someone other than the applicant.
 */
async function confirmClaimToken(token: string): Promise<ClaimConfirmation> {
  try {
    const res = await fetch("/api/institution-claims/confirm", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: string;
      organisation_name?: string | null;
    };
    return {
      outcome: claimConfirmationOutcome(res.status, data.code),
      organisationName:
        res.ok && typeof data.organisation_name === "string" ? data.organisation_name : null,
    };
  } catch {
    return { outcome: "unavailable", organisationName: null };
  }
}

export default function SetupPage() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [checking, setChecking] = useState(true);
  const [formErrorKey, setFormErrorKey] = useState<string | null>(null);
  // A confirmation link opened without a session gets its own result screen;
  // a signed-in applicant gets a toast and carries on with setup.
  const [signedOutConfirmation, setSignedOutConfirmation] = useState<ClaimConfirmation | null>(
    null
  );
  const [confirmationNotice, setConfirmationNotice] = useState<ClaimConfirmation | null>(null);
  // A Google sign-in never passes the register form, so this is the first
  // place it can state its age and accept the terms. Asked before any role
  // is saved, for any account whose metadata does not record the current
  // version yet.
  const [needsTerms, setNeedsTerms] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  // Survives the development double-run of the effect below, which must not
  // lose the token it already took out of the address bar.
  const confirmationRef = useRef<Promise<ClaimConfirmation> | null>(null);

  useEffect(() => {
    // The token is handled before, and independently of, the session check:
    // the old order sent a signed-out visitor to /auth/login first and the
    // token was lost with the page. It leaves the address bar before any
    // request is made.
    if (!confirmationRef.current) {
      const { token, cleaned } = takeClaimToken(window.location.href);
      if (token) {
        window.history.replaceState(null, "", cleaned);
        confirmationRef.current = confirmClaimToken(token);
      }
    }
    const confirmation = confirmationRef.current;
    // "Claim this profile" links from an existing account carry the same
    // intent as picking "NGO" at sign-up. Routing only; it grants nothing.
    const presetNgo =
      signupRoleFromParams(new URLSearchParams(window.location.search)) === "ngo";
    let cancelled = false;

    if (!isSupabaseConfigured) {
      void (async () => {
        const result = confirmation ? await confirmation : null;
        if (cancelled) return;
        if (result) setSignedOutConfirmation(result);
        else setFormErrorKey(AUTH_NOT_CONFIGURED);
        setChecking(false);
      })();
      return () => {
        cancelled = true;
      };
    }

    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return;
      if (!data.user) {
        if (confirmation) {
          const result = await confirmation;
          if (cancelled) return;
          setSignedOutConfirmation(result);
          setChecking(false);
          return;
        }
        router.replace("/auth/login");
        return;
      }
      const user = data.user;
      if (confirmation) {
        // Waiting here means the claim below is read after the confirmation
        // has landed, so it already shows the confirmed mailbox.
        const result = await confirmation;
        if (cancelled) return;
        setConfirmationNotice(result);
      }
      const isOAuth =
        user.app_metadata?.provider !== "email" &&
        user.app_metadata?.provider !== undefined;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, institution_id")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;

      const r = normalizeRole(profile?.role);
      const setupDone = user.user_metadata?.setup_completed === true;
      setNeedsTerms(!hasAcceptedCurrentTerms(user.user_metadata));
      // handle_new_user() always creates the profile as `individual` --
      // signup metadata is never trusted for the role itself. This is the
      // only place that intent survives until complete_profile_setup runs,
      // so a still-`individual` profile that asked for `ngo` at signup must
      // reach the claim UI below rather than get bounced by the "nothing to
      // configure" rule that follows.
      const pickedNgo = user.user_metadata?.role === "ngo";

      if (r === "ngo" && profile?.institution_id) {
        router.replace("/dashboard");
        return;
      }
      // An NGO account with no institution has not finished onboarding: it is
      // waiting on a claim against the official register.
      if (r === "ngo" && !profile?.institution_id) {
        setRole("ngo");
        setChecking(false);
        return;
      }
      if (r === "individual" && (pickedNgo || presetNgo)) {
        setRole("ngo");
        setChecking(false);
        return;
      }
      // Past this point every remaining `individual` case gets the plain role
      // picker (below) rather than a bounce -- including a plain email/password
      // account that arrives here from a "claim this profile" link. The one
      // case still sent home is an OAuth account that already finished this
      // screen once, so it doesn't loop back into the picker on every
      // subsequent sign-in.
      if (r === "individual" && isOAuth && setupDone) {
        router.replace("/dashboard");
        return;
      }

      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!confirmationNotice) return;
    toast(
      confirmationNotice.outcome === "confirmed"
        ? {
            tone: "success",
            title: t("claims.email_confirmed_toast"),
            description: confirmationNotice.organisationName ?? undefined,
          }
        : {
            tone: "error",
            title: t("claims.email_confirm_failed"),
            description: t(CONFIRMATION_MESSAGE[confirmationNotice.outcome]),
          }
    );
    setConfirmationNotice(null);
  }, [confirmationNotice, t, toast]);

  function selectRole(next: UserRole) {
    setRole(next);
    setFormErrorKey(null);
  }

  async function switchAccount() {
    setSwitchingAccount(true);
    setFormErrorKey(null);
    try {
      if (!isSupabaseConfigured) throw new Error(AUTH_NOT_CONFIGURED);
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      // Reset client caches and leave the pending claim attached to its owner.
      window.location.replace("/auth/login");
    } catch (error) {
      setFormErrorKey(authErrorKey(error));
      setSwitchingAccount(false);
    }
  }

  /**
   * Grants the unlinked `ngo` role. It creates no institution: publishing an
   * organisation requires an approved claim against the official register.
   */
  const ensureNgoRole = useCallback(async () => {
    if (!isSupabaseConfigured) throw new Error(AUTH_NOT_CONFIGURED);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error(AUTH_NOT_AUTHENTICATED);

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (normalizeRole(profile?.role) !== "ngo") {
      const { error } = await supabase.rpc("complete_profile_setup", {
        p_role: "ngo",
        p_institution_name: null,
      });
      if (error) throw error;
    }
    await supabase.auth.updateUser({
      data: { role: "ngo", ...(needsTerms ? termsAcceptance() : {}) },
    });
  }, [needsTerms]);

  const handleApproved = useCallback(() => router.replace("/dashboard"), [router]);

  async function completeIndividualSetup() {
    if (!isSupabaseConfigured) {
      setFormErrorKey(AUTH_NOT_CONFIGURED);
      return;
    }
    if (needsTerms && !termsAccepted) {
      setFormErrorKey("auth.terms_required");
      return;
    }
    setLoading(true);
    setFormErrorKey(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setFormErrorKey(AUTH_NOT_AUTHENTICATED);
        setLoading(false);
        return;
      }

      // Also the way back for an `ngo` account that never got an
      // organisation: the RPC switches it to `individual` as long as no
      // claim is still under review, and leaves it `ngo` otherwise.
      const { data: setupRows, error: setupErr } = await supabase.rpc(
        "complete_profile_setup",
        { p_role: "individual", p_institution_name: null }
      );
      if (setupErr) {
        if (setupErr.code === "P0001") {
          setFormErrorKey("auth.setup_individual_blocked");
          setLoading(false);
          return;
        }
        throw setupErr;
      }
      const row = (Array.isArray(setupRows) ? setupRows[0] : setupRows) as
        | { profile_role?: string | null }
        | null
        | undefined;
      const nextRole = normalizeRole(row?.profile_role);
      if (nextRole === "ngo") {
        setFormErrorKey("auth.setup_individual_blocked");
        setLoading(false);
        return;
      }

      await supabase.auth.updateUser({
        data: {
          role: "individual",
          setup_completed: true,
          ...(needsTerms ? termsAcceptance() : {}),
        },
      });
      // The dashboard guard reads user_metadata from the session JWT, and
      // updateUser() does not reissue it. Without a refresh, an account that
      // signed up as an NGO would be sent straight back here until the old
      // token expired.
      await supabase.auth.refreshSession().catch(() => undefined);

      router.replace(roleToDashboardPath(nextRole));
    } catch (e) {
      // Raw database messages are not user-facing copy; map to a translated one.
      setFormErrorKey(authErrorKey(e));
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-gradient-to-b from-brand-soft/60 to-surface px-4 py-12">
        <p role="status" className="inline-flex items-center gap-2 text-base text-ink-secondary">
          <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden="true" />
          {t("auth.setup_checking")}
        </p>
      </div>
    );
  }

  if (signedOutConfirmation) {
    const { outcome, organisationName } = signedOutConfirmation;
    const contactLink = ORGANISATION.contactEmail ? (
      <a href={`mailto:${ORGANISATION.contactEmail}`} className={authLinkClasses}>
        {ORGANISATION.contactEmail}
      </a>
    ) : null;
    return (
      <AuthShell title={t("claims.confirm_title")}>
        <div className="space-y-5">
          {outcome === "confirmed" ? (
            <>
              <AuthAlert tone="success">{t("claims.confirm_success")}</AuthAlert>
              {organisationName ? (
                <p className="break-words text-base font-semibold text-ink">{organisationName}</p>
              ) : null}
              <p className="text-sm leading-6 text-ink-secondary">
                {t("claims.confirm_success_note")}
              </p>
            </>
          ) : (
            <>
              <AuthAlert>{t(CONFIRMATION_MESSAGE[outcome])}</AuthAlert>
              {outcome === "invalid" && contactLink ? (
                <p className="text-sm leading-6 text-ink-secondary">
                  {richText(t("claims.confirm_invalid_next"), { email: contactLink })}
                </p>
              ) : null}
            </>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/" className={buttonClasses({ fullWidth: true })}>
              {t("errors.go_to_map")}
            </Link>
            <Link
              href="/auth/login"
              className={buttonClasses({ variant: "secondary", fullWidth: true })}
            >
              {t("nav.sign_in")}
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  const termsBlocked = needsTerms && !termsAccepted;
  const termsConsent = needsTerms ? (
    <TermsConsent
      checked={termsAccepted}
      onChange={(next) => {
        setTermsAccepted(next);
        if (next && formErrorKey === "auth.terms_required") setFormErrorKey(null);
      }}
    />
  ) : null;

  return (
    <AuthShell
      width="lg"
      title={t("auth.setup_title")}
      subtitle={t("auth.setup_subtitle")}
    >
      <div className="space-y-6">
        {formErrorKey ? <AuthAlert>{t(formErrorKey)}</AuthAlert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <RoleTile
            selected={role === "individual"}
            onSelect={() => selectRole("individual")}
            icon={
              <Heart
                className={TILE_ICON}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            }
            title={t("auth.role_individual_title")}
            subtitle={t("auth.role_individual_subtitle")}
          />
          <RoleTile
            selected={role === "ngo"}
            onSelect={() => selectRole("ngo")}
            icon={
              <Building2
                className={TILE_ICON}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            }
            title={t("auth.role_ngo_title")}
            subtitle={t("auth.role_ngo_subtitle")}
          />
        </div>

        {role === "ngo" ? (
          <>
            <InstitutionClaimSetup
              ensureNgoRole={ensureNgoRole}
              onApproved={handleApproved}
              consent={termsConsent}
              submitBlocked={termsBlocked}
            />
            <div className="space-y-3 border-t border-border-subtle pt-6">
              <p className="text-sm leading-6 text-ink-secondary">
                {t("auth.switch_account_body")}
              </p>
              <Button
                variant="secondary"
                fullWidth
                loading={switchingAccount}
                onClick={() => void switchAccount()}
              >
                {t("auth.switch_account")}
              </Button>
            </div>
          </>
        ) : (
          <>
            {termsConsent}
            <Button
              size="lg"
              fullWidth
              loading={loading}
              disabled={role !== "individual" || termsBlocked}
              onClick={() => void completeIndividualSetup()}
            >
              {t("common.continue")}
            </Button>
          </>
        )}
      </div>
    </AuthShell>
  );
}
