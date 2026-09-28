"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { Card, useToast } from "@/components/ui";
import { useT } from "@/i18n/client";

/**
 * The switch for the e-mail copy of in-app notifications. The change shows
 * at once and reverts if the server refuses it, so the switch never claims
 * a state the account is not in.
 */
export function EmailNotificationSettings({
  initialEnabled,
  email,
}: {
  initialEnabled: boolean;
  email: string;
}) {
  const t = useT();
  const toast = useToast();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  async function change(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    try {
      const res = await fetch("/api/me/email-notifications", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({
        tone: "success",
        title: t(next ? "account.email_on_toast" : "account.email_off_toast"),
      });
    } catch {
      setEnabled(previous);
      toast({ tone: "error", title: t("account.email_failed") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" padding="lg" id="obavijesti-e-postom" aria-labelledby="email-notifications-heading">
      <h2
        id="email-notifications-heading"
        className="flex items-center gap-2 text-lg font-semibold text-ink"
      >
        <Mail className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
        {t("account.email_title")}
      </h2>
      <p className="mt-2 text-base leading-7 text-ink-secondary">
        {t("account.email_body", { email })}
      </p>
      <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-control border border-border-subtle bg-surface-sunken px-4 py-3">
        <span className="text-base font-medium text-ink">{t("account.email_toggle")}</span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          aria-checked={enabled}
          disabled={saving}
          onChange={(event) => void change(event.target.checked)}
          className="h-5 w-5 shrink-0 cursor-pointer accent-brand disabled:cursor-wait"
        />
      </label>
    </Card>
  );
}
