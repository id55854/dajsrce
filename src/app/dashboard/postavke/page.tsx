import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTranslator } from "@/i18n/server";
import { PageHeader, PageShell, buttonClasses } from "@/components/ui";
import { EmailNotificationSettings } from "@/components/account/EmailNotificationSettings";

export const metadata: Metadata = {
  title: "Postavke računa",
  robots: { index: false, follow: false },
};

/** Account settings for every role: notification e-mail and sign-in security. */
export default async function AccountSettingsPage() {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect("/auth/login?next=/dashboard/postavke");

  const t = await getTranslator();
  const supabase = await createServerSupabaseClient();
  // Own row only (RLS). A failed read shows the default, which is on.
  const { data } = await supabase
    .from("profiles")
    .select("email_notifications_enabled")
    .eq("id", profile.id)
    .maybeSingle();
  const emailEnabled =
    (data as { email_notifications_enabled?: boolean | null } | null)?.email_notifications_enabled !== false;

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("account.eyebrow")}
        title={t("account.title")}
        subtitle={t("account.subtitle")}
      />
      <div className="space-y-6">
        <EmailNotificationSettings initialEnabled={emailEnabled} email={profile.email} />
      </div>
      <div className="mt-8 border-t border-border-subtle pt-6">
        <Link href="/dashboard" className={buttonClasses({ variant: "secondary" })}>
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("account.back")}
        </Link>
      </div>
    </PageShell>
  );
}
