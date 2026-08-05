"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Building2, BriefcaseBusiness, Heart } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { useT } from "@/i18n/client";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
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
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [institutionName, setInstitutionName] = useState("");
  // Form-level failures (service, credentials) live in the banner; per-field
  // problems live under their field. Both are stored as translation keys.
  const [formErrorKey, setFormErrorKey] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    password?: string;
    institution?: string;
  }>({});
  const [successKey, setSuccessKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const nextParam = searchParams.get("next");
  const nextQuery = nextParam ? `?next=${encodeURIComponent(nextParam)}` : "";

  const passwordTooShort =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  // Validate on blur, not on every keystroke, so the message does not fight
  // the user while they are still typing.
  const passwordError =
    fieldErrors.password ??
    (passwordTouched && passwordTooShort ? "auth.password_too_short" : undefined);

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
    setFieldErrors({});
    setSuccessKey(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormErrorKey(null);
    setFieldErrors({});
    setSuccessKey(null);

    if (!isSupabaseConfigured) {
      setFormErrorKey(AUTH_NOT_CONFIGURED);
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldErrors({ password: "auth.password_too_short" });
      setPasswordTouched(true);
      return;
    }
    if (!role) {
      setFormErrorKey("auth.role_required");
      return;
    }
    if ((role === "ngo" || role === "company") && !institutionName.trim()) {
      setFieldErrors({
        institution:
          role === "company"
            ? "auth.company_name_required"
            : "auth.ngo_name_required",
      });
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
          data: {
            name,
            role,
            ...(role === "ngo" || role === "company"
              ? { institution_name: institutionName.trim() }
              : {}),
          },
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
      const fallback =
        role === "company" ? "/dashboard/company/new" : "/dashboard";
      window.location.href = searchParams.get("next") || fallback;
      return;
    }

    // Deliberately not a toast: confirming the mailbox is an instruction the
    // user has to act on, so it has to stay on screen.
    setSuccessKey("auth.sign_up_confirm_email");
  }

  const institutionLabel =
    role === "company"
      ? t("auth.company_name_label")
      : t("auth.ngo_name_label");

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
            <RoleTile
              selected={role === "company"}
              onSelect={() => selectRole("company")}
              icon={
                <BriefcaseBusiness
                  className={TILE_ICON}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              }
              title={t("company.role_tile_title")}
              subtitle={t("company.role_tile_subtitle")}
              className="sm:col-span-2"
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
              {role === "company"
                ? t("company.role_tile_title")
                : role === "ngo"
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
              onBlur={() => setPasswordTouched(true)}
              error={
                passwordError
                  ? t(passwordError, { min: MIN_PASSWORD_LENGTH })
                  : undefined
              }
            />

            {role === "ngo" || role === "company" ? (
              <Field
                label={institutionLabel}
                required
                requiredLabel={t("common.required")}
                error={
                  fieldErrors.institution
                    ? t(fieldErrors.institution)
                    : undefined
                }
              >
                {(field) => (
                  <Input
                    {...field}
                    name="institution"
                    type="text"
                    autoComplete="organization"
                    required
                    invalid={Boolean(fieldErrors.institution)}
                    value={institutionName}
                    onChange={(e) => setInstitutionName(e.target.value)}
                  />
                )}
              </Field>
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
