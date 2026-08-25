"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Building2, Heart } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { useT } from "@/i18n/client";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { evaluatePassword } from "@/lib/password-strength";
import type { UserRole } from "@/lib/types";
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
  RoleTile,
  authLinkClasses,
  describedBy,
} from "../auth-ui";

const FORM_ERROR_ID = "register-form-error";
const TILE_ICON = "h-10 w-10";

function RegisterForm() {
  const t = useT();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<1 | 2>(1);
  const [role, setRole] = useState<UserRole | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Form-level failures (service, credentials) live in the banner.
  const [formErrorKey, setFormErrorKey] = useState<string | null>(null);
  const [successKey, setSuccessKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const nextParam = searchParams.get("next");
  const nextQuery = nextParam ? `?next=${encodeURIComponent(nextParam)}` : "";

  // The name and email already on the form are what makes the deny-list
  // personal: a password built out of either is the first thing anyone guesses.
  const strength = useMemo(
    () =>
      evaluatePassword(password, {
        minLength: MIN_PASSWORD_LENGTH,
        email,
        name,
      }),
    [password, email, name]
  );

  function selectRole(next: UserRole) {
    setRole(next);
    setFormErrorKey(null);
  }

  function goToForm() {
    if (!role) {
      setFormErrorKey("auth.role_required");
      return;
    }
    setFormErrorKey(null);
    setStep(2);
  }

  function backToRoles() {
    setStep(1);
    setFormErrorKey(null);
    setSuccessKey(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormErrorKey(null);
    setSuccessKey(null);

    if (!isSupabaseConfigured) {
      setFormErrorKey(AUTH_NOT_CONFIGURED);
      return;
    }

    // Hard rules only: length and the deny-list, surfaced entirely through the
    // strength meter next to the field -- no separate message spells out
    // which rule tripped, so the field itself never hints at what the deny
    // list checks for. The strength score alone never blocks a submission.
    if (strength.rejectionKey) return;
    if (!role) {
      setFormErrorKey("auth.role_required");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    let data: Awaited<ReturnType<typeof supabase.auth.signUp>>["data"] | null =
      null;
    let failure: string | null = null;
    try {
      const response = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(searchParams.get("next") || "/dashboard")}`,
          data: { name, role },
        },
      });
      data = response.data;
      if (response.error) failure = authErrorKey(response.error);
    } catch {
      failure = AUTH_NETWORK_ERROR;
    }
    setLoading(false);

    if (failure || !data) {
      setFormErrorKey(failure ?? "auth.sign_up_failed");
      return;
    }

    if (data.session) {
      // handle_new_user() always creates the profile as `individual` — role
      // is never trusted from signup metadata. An NGO pick still has to run
      // through /auth/setup, which grants the role via complete_profile_setup
      // and then walks the applicant through the UDR_ID claim.
      window.location.href =
        role === "ngo" ? "/auth/setup" : searchParams.get("next") || "/dashboard";
      return;
    }

    // Deliberately not a toast: confirming the mailbox is an instruction the
    // user has to act on, so it has to stay on screen.
    setSuccessKey("auth.sign_up_confirm_email");
  }

  return (
    <AuthShell
      width="lg"
      title={step === 1 ? t("auth.role_title") : t("auth.sign_up_title")}
      subtitle={step === 1 ? t("auth.role_subtitle") : undefined}
      footer={
        <>
          {t("auth.have_account")}{" "}
          <Link href={`/auth/login${nextQuery}`} className={authLinkClasses}>
            {t("auth.sign_in_link")}
          </Link>
        </>
      }
    >
      {step === 1 ? (
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

          <Button size="lg" fullWidth onClick={goToForm}>
            {t("common.continue")}
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-6 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-ink">
              {role === "ngo"
                ? t("auth.role_ngo_title")
                : t("auth.role_individual_title")}
            </h2>
            <Button variant="ghost" onClick={backToRoles}>
              {t("common.back")}
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {formErrorKey ? (
              <AuthAlert id={FORM_ERROR_ID}>{t(formErrorKey)}</AuthAlert>
            ) : null}
            {successKey ? (
              <AuthAlert tone="success">{t(successKey)}</AuthAlert>
            ) : null}

            <Field
              label={t("auth.full_name_label")}
              required
              requiredLabel={t("common.required")}
            >
              {(field) => (
                <Input
                  {...field}
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>

            <Field
              label={t("auth.email_label")}
              required
              requiredLabel={t("common.required")}
            >
              {(field) => (
                <Input
                  {...field}
                  aria-describedby={describedBy(
                    field["aria-describedby"],
                    formErrorKey ? FORM_ERROR_ID : undefined
                  )}
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>

            <PasswordField
              label={t("auth.password_label_min", { min: MIN_PASSWORD_LENGTH })}
              name="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={setPassword}
              strength={password.length > 0 ? strength : null}
            />

            {role === "ngo" ? (
              <p className="text-sm text-ink-secondary">
                {t("auth.ngo_claim_hint")}
              </p>
            ) : null}

            <Button type="submit" size="lg" fullWidth loading={loading}>
              {t("auth.sign_up_cta")}
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
