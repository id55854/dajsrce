"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui";
import { useT } from "@/i18n/client";
import { createClient } from "@/lib/supabase/client";
import { inviteErrorKey } from "../auth-validation";
import { AuthAlert, AuthShell } from "../auth-ui";

type State = "idle" | "loading" | "success" | "error" | "need_login";

export function AcceptInviteClient() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, setState] = useState<State>("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setState("need_login");
      }
    })();
  }, [token]);

  async function acceptInvite() {
    setState("loading");
    setErrorKey(null);
    try {
      const res = await fetch("/api/companies/invite/accept", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        // The API answers in English; translate from its status code rather
        // than echoing the response body.
        setErrorKey(inviteErrorKey(res.status));
        setState("error");
        return;
      }
      setCompanyId(data.company_id);
      document.cookie = `active_company=${data.company_id}; path=/; max-age=${60 * 60 * 24 * 180}; SameSite=Lax`;
      setState("success");
      setTimeout(() => {
        router.push(`/dashboard/company?cid=${data.company_id}`);
      }, 1500);
    } catch {
      setErrorKey("auth.error_network");
      setState("error");
    }
  }

  if (!token) {
    return (
      <AuthShell title={t("auth.invite_title")}>
        <AuthAlert>{t("auth.invite_missing_token")}</AuthAlert>
      </AuthShell>
    );
  }

  if (state === "need_login") {
    const backHere = encodeURIComponent(`/auth/invite?token=${token}`);
    return (
      <AuthShell
        title={t("auth.invite_title")}
        subtitle={t("auth.invite_need_login")}
      >
        {/* A grid, not a flex row: `buttonClasses` already sets `shrink-0`, so a
            `flex-1` here would be a coin flip on Tailwind's declaration order. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href={`/auth/login?next=${backHere}`}
            className={buttonClasses({ size: "lg" })}
          >
            {t("auth.sign_in_cta")}
          </Link>
          <Link
            href={`/auth/register?next=${backHere}`}
            className={buttonClasses({ variant: "secondary", size: "lg" })}
          >
            {t("auth.create_account")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.invite_title")}
      subtitle={state === "idle" ? t("auth.invite_subtitle") : undefined}
    >
      {state === "loading" ? (
        <p
          role="status"
          className="inline-flex items-center gap-2 text-base text-ink-secondary"
        >
          <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden="true" />
          {t("common.loading")}
        </p>
      ) : state === "idle" ? (
        <Button size="lg" fullWidth onClick={acceptInvite}>
          {t("auth.invite_accept")}
        </Button>
      ) : state === "success" ? (
        <div className="space-y-3">
          <AuthAlert tone="success">{t("auth.invite_accepted")}</AuthAlert>
          {companyId ? (
            <p role="status" className="text-base text-ink-secondary">
              {t("auth.invite_redirecting")}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <AuthAlert>{t(errorKey ?? "common.error_generic")}</AuthAlert>
          <Button variant="secondary" size="lg" fullWidth onClick={acceptInvite}>
            {t("errors.retry")}
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
