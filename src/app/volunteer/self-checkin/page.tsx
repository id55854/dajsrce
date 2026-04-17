"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, MapPin } from "lucide-react";
import { useT } from "@/i18n/client";

function SelfCheckInInner() {
  const t = useT();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("event");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function confirm() {
    if (!eventId) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/volunteer-signups/self-check-in", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === "string" ? data.error : t("volunteer_self.error_generic"));
        return;
      }
      setOk(true);
      setMessage(data.already ? t("volunteer_self.already") : t("volunteer_self.thank_you"));
    } finally {
      setLoading(false);
    }
  }

  if (!eventId) {
    return <p className="text-sm text-gray-600 dark:text-gray-400">{t("volunteer_self.missing_event")}</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">{t("volunteer_self.intro")}</p>
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={loading || ok}
        className="inline-flex items-center gap-2 rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MapPin className="h-4 w-4" aria-hidden />}
        {ok ? t("volunteer_self.done") : t("volunteer_self.button")}
      </button>
      {message ? (
        <p className={`text-sm ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {message}
        </p>
      ) : null}
      <p className="text-xs text-gray-500">
        <Link href="/auth/login" className="font-semibold text-red-600 hover:underline">
          {t("volunteer_self.sign_in")}
        </Link>
      </p>
    </div>
  );
}

export default function VolunteerSelfCheckInPage() {
  const t = useT();
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">{t("volunteer_self.title")}</h1>
      <Suspense fallback={<p className="text-sm text-gray-500">{t("common.loading")}</p>}>
        <SelfCheckInInner />
      </Suspense>
    </div>
  );
}
