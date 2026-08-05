"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MapPin } from "lucide-react";
import { useT } from "@/i18n/client";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  PageShell,
  SkeletonText,
  buttonClasses,
} from "@/components/ui";

function SelfCheckInInner() {
  const t = useT();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("event");
  const token = searchParams.get("token");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function confirm() {
    if (!eventId || !token) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/volunteer-signups/self-check-in", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The API's `error` field is an internal English string; the user gets
        // the localized equivalent.
        setMessage(t("volunteer_self.error_generic"));
        return;
      }
      setOk(true);
      setMessage(data.already ? t("volunteer_self.already") : t("volunteer_self.thank_you"));
    } finally {
      setLoading(false);
    }
  }

  if (!eventId || !token) {
    return (
      <EmptyState
        icon={<MapPin className="h-10 w-10" aria-hidden="true" />}
        title={t("volunteer_self.missing_event")}
        action={
          <Link href="/volunteer" className={buttonClasses({ variant: "secondary" })}>
            {t("volunteer_page.title")}
          </Link>
        }
      />
    );
  }

  return (
    <Card className="space-y-4">
      <p className="text-base text-ink-secondary">{t("volunteer_self.intro")}</p>
      <Button
        onClick={() => void confirm()}
        loading={loading}
        disabled={ok}
        fullWidth
        icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
      >
        {ok ? t("volunteer_self.done") : t("volunteer_self.button")}
      </Button>
      {message ? (
        <p
          role={ok ? "status" : "alert"}
          className={
            ok
              ? "rounded-control bg-success-soft px-3 py-2 text-sm text-success-on-soft"
              : "rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
          }
        >
          {message}
        </p>
      ) : null}
      <p className="text-sm text-ink-tertiary">
        <Link
          href="/auth/login"
          className="rounded font-semibold text-brand underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {t("volunteer_self.sign_in")}
        </Link>
      </p>
    </Card>
  );
}

export default function VolunteerSelfCheckInPage() {
  const t = useT();
  return (
    <PageShell width="narrow">
      <PageHeader title={t("volunteer_self.title")} />
      <Suspense
        fallback={
          <Card>
            <SkeletonText lines={3} />
          </Card>
        }
      >
        <SelfCheckInInner />
      </Suspense>
    </PageShell>
  );
}
