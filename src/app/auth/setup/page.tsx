"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Heart, Loader2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { useT } from "@/i18n/client";
import { normalizeRole } from "@/lib/auth/roles";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types";
import {
  AUTH_NOT_AUTHENTICATED,
  AUTH_NOT_CONFIGURED,
  authErrorKey,
} from "../auth-validation";
import { AuthAlert, AuthShell, RoleTile } from "../auth-ui";

const TILE_ICON = "h-10 w-10";

export default function SetupPage() {
  const t = useT();
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [institutionName, setInstitutionName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [formErrorKey, setFormErrorKey] = useState<string | null>(null);
  const [nameErrorKey, setNameErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setChecking(false);
      setFormErrorKey(AUTH_NOT_CONFIGURED);
      return;
    }
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace("/auth/login");
        return;
      }
      const user = data.user;
      const isOAuth =
        user.app_metadata?.provider !== "email" &&
        user.app_metadata?.provider !== undefined;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, institution_id")
        .eq("id", user.id)
        .maybeSingle();

      const r = normalizeRole(profile?.role);
      const setupDone = user.user_metadata?.setup_completed === true;

      if (r === "ngo" && profile?.institution_id) {
        router.replace("/dashboard");
        return;
      }
      if (r === "ngo" && !profile?.institution_id) {
        setChecking(false);
        return;
      }
      if (r === "individual" && !isOAuth) {
        router.replace("/dashboard");
        return;
      }
      if (r === "individual" && isOAuth && setupDone) {
        router.replace("/dashboard");
        return;
      }

      setChecking(false);
    });
  }, [router]);

  function selectRole(next: UserRole) {
    setRole(next);
    setFormErrorKey(null);
    setNameErrorKey(null);
  }

  async function handleSubmit() {
    setNameErrorKey(null);
    if (!isSupabaseConfigured) {
      setFormErrorKey(AUTH_NOT_CONFIGURED);
      return;
    }
    if (!role) {
      setFormErrorKey("auth.role_required");
      return;
    }
    if (role === "ngo" && !institutionName.trim()) {
      setNameErrorKey("auth.ngo_name_required");
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

      const { error: setupErr } = await supabase.rpc("complete_profile_setup", {
        p_role: role,
        p_institution_name: role === "ngo" ? institutionName.trim() : null,
      });

      if (setupErr) throw setupErr;

      const meta: Record<string, string | boolean> = { role };
      if (role === "individual") {
        meta.setup_completed = true;
      }

      await supabase.auth.updateUser({
        data: meta,
      });

      router.replace("/dashboard");
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
          <Field
            label={t("auth.ngo_name_label")}
            required
            requiredLabel={t("common.required")}
            error={nameErrorKey ? t(nameErrorKey) : undefined}
          >
            {(field) => (
              <Input
                {...field}
                name="ngo-name"
                type="text"
                autoComplete="organization"
                required
                invalid={Boolean(nameErrorKey)}
                placeholder={t("auth.ngo_name_placeholder")}
                value={institutionName}
                onChange={(e) => setInstitutionName(e.target.value)}
              />
            )}
          </Field>
        ) : null}

        <Button
          size="lg"
          fullWidth
          loading={loading}
          disabled={!role}
          onClick={handleSubmit}
        >
          {t("common.continue")}
        </Button>
      </div>
    </AuthShell>
  );
}
