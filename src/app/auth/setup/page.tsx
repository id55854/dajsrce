"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { InstitutionClaimSetup } from "@/components/InstitutionClaimSetup";
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
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [formErrorKey, setFormErrorKey] = useState<string | null>(null);

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
      // An NGO account with no institution has not finished onboarding: it is
      // waiting on a claim against the official register.
      if (r === "ngo" && !profile?.institution_id) {
        setRole("ngo");
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
    await supabase.auth.updateUser({ data: { role: "ngo" } });
  }, []);

  async function completeIndividualSetup() {
    if (!isSupabaseConfigured) {
      setFormErrorKey(AUTH_NOT_CONFIGURED);
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
        p_role: "individual",
        p_institution_name: null,
      });
      if (setupErr) throw setupErr;

      await supabase.auth.updateUser({
        data: { role: "individual", setup_completed: true },
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
          <InstitutionClaimSetup
            ensureNgoRole={ensureNgoRole}
            onApproved={() => router.replace("/dashboard")}
          />
        ) : (
          <Button
            size="lg"
            fullWidth
            loading={loading}
            disabled={role !== "individual"}
            onClick={() => void completeIndividualSetup()}
          >
            {t("common.continue")}
          </Button>
        )}
      </div>
    </AuthShell>
  );
}
