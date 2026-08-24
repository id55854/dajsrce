import { redirect } from "next/navigation";
import { BadgeCheck, Heart, ListChecks, ShieldQuestion, Users } from "lucide-react";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTranslator } from "@/i18n/server";
import { Card, PageHeader, PageShell, Stat } from "@/components/ui";
import type { InstitutionClaimReviewItem } from "@/lib/institution-claims";
import { SignOutButton } from "@/components/SignOutButton";
import { InstitutionClaimQueue } from "./institution-claim-queue";

export default async function SuperadminDashboardPage() {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect("/auth/login?next=/dashboard/admin");
  if (profile.role !== "superadmin") redirect("/dashboard");

  const t = await getTranslator();

  const [profiles, needs, pledges, institutions, claimQueue] = await Promise.all([
    supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("needs").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("pledges").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("institutions")
      .select("id", { count: "exact", head: true })
      .eq("is_verified", false),
    // The RPC re-checks the superadmin role from profiles; the redirect above
    // is the friendly path, not the control.
    supabaseAdmin.rpc("list_institution_claims_for_review", {
      p_reviewer_id: profile.id,
      p_status: "open",
      p_limit: 50,
    }),
  ]);

  const queuePayload = (claimQueue.data ?? {}) as { items?: InstitutionClaimReviewItem[] };
  const claims = Array.isArray(queuePayload.items) ? queuePayload.items : [];

  const cards = [
    { label: "Users", value: profiles.count, icon: <Users className="h-4 w-4" aria-hidden="true" /> },
    {
      label: "Active needs",
      value: needs.count,
      icon: <ListChecks className="h-4 w-4" aria-hidden="true" />,
    },
    {
      label: "Donations",
      value: pledges.count,
      icon: <Heart className="h-4 w-4" aria-hidden="true" />,
    },
    {
      label: "Unverified NGOs",
      value: institutions.count,
      icon: <BadgeCheck className="h-4 w-4" aria-hidden="true" />,
    },
    {
      label: t("admin.claims_pending_stat"),
      value: claimQueue.error ? null : claims.length,
      icon: <ShieldQuestion className="h-4 w-4" aria-hidden="true" />,
    },
  ];

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Superadmin"
        title={t("admin.title")}
        subtitle={t("admin.subtitle")}
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <Stat
            key={card.label}
            icon={card.icon}
            label={card.label}
            // A failed count query returns null; an em-dash says "unknown"
            // rather than claiming zero.
            value={card.value ?? "—"}
            tone={card.value == null ? "muted" : "default"}
          />
        ))}
      </section>

      {claimQueue.error ? (
        <Card padding="lg" className="mt-8">
          <h2 className="text-lg font-semibold text-ink">{t("admin.claims_title")}</h2>
          <p className="mt-2 text-base leading-7 text-ink-secondary">
            {t("admin.claims_unavailable")}
          </p>
        </Card>
      ) : (
        <InstitutionClaimQueue claims={claims} />
      )}

      <Card padding="lg" className="mt-8">
        <h2 className="text-lg font-semibold text-ink">{t("admin.other_tools_title")}</h2>
        <p className="mt-2 text-base leading-7 text-ink-secondary">
          {t("admin.other_tools_body")}
        </p>
      </Card>

      <div className="mt-8 border-t border-border-subtle pt-6">
        <SignOutButton />
      </div>
    </PageShell>
  );
}
