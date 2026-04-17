"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2, Mail } from "lucide-react";
import { useT } from "@/i18n/client";
import { createClient } from "@/lib/supabase/client";

type State = "idle" | "loading" | "success" | "error" | "need_login";

export function AcceptInviteClient() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setState("need_login");
        return;
      }
      setState("loading");
      try {
        const res = await fetch("/api/companies/invite/accept", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? t("common.error_generic"));
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
        setError(t("common.error_generic"));
        setState("error");
      }
    })();
  }, [token, router, t]);

  if (!token) {
    return (
      <Shell>
        <p className="text-sm text-red-600">Missing invite token.</p>
      </Shell>
    );
  }

  if (state === "need_login") {
    return (
      <Shell>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Prijavite se kako biste prihvatili pozivnicu. Sign in to accept this invite.
        </p>
        <div className="flex gap-2">
          <Link
            href={`/auth/login?next=${encodeURIComponent(`/auth/invite?token=${token}`)}`}
            className="rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
          >
            Sign in
          </Link>
          <Link
            href={`/auth/register?next=${encodeURIComponent(`/auth/invite?token=${token}`)}`}
            className="rounded-full border border-red-500 px-4 py-2 text-sm font-semibold text-red-500 hover:bg-red-50"
          >
            Create account
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {state === "loading" || state === "idle" ? (
        <p className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </p>
      ) : state === "success" ? (
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Check className="h-4 w-4" /> Welcome aboard
          </p>
          {companyId ? (
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              Redirecting to your company dashboard…
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
          {error ?? t("common.error_generic")}
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <Mail className="h-3.5 w-3.5" />
          Company invitation
        </div>
        {children}
      </div>
    </div>
  );
}
