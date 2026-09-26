import { redirect } from "next/navigation";
import { BadgeCheck, Heart, ListChecks, ShieldQuestion, Users } from "lucide-react";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTranslator } from "@/i18n/server";
import { Card, PageHeader, PageShell, Stat } from "@/components/ui";
import type { InstitutionClaimReviewPage } from "@/lib/institution-claims";
import { SignOutButton } from "@/components/SignOutButton";
import { InstitutionClaimQueue } from "./institution-claim-queue";

/** The review RPC's own cap; the queue says so when more are waiting. */
const CLAIM_QUEUE_LIMIT = 100;

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
      p_limit: CLAIM_QUEUE_LIMIT,
    }),
  ]);

  const queuePayload = (claimQueue.data ?? {}) as InstitutionClaimReviewPage;
  // Oldest first, so the earliest applicants are not the ones who wait
  // longest. The RPC already orders an open queue that way; sorting again
  // keeps the rule even on a schema that predates it.
  const claims = (Array.isArray(queuePayload.items) ? queuePayload.items : [])
    .slice()
    .sort(
      (a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id)
    );
  // The page shows at most CLAIM_QUEUE_LIMIT; the stat is the real backlog.
  const claimTotal =
    typeof queuePayload.total === "number" ? queuePayload.total : claims.length;

  const cards = [
    {
      label: t("admin.stat_users"),
      value: profiles.count,
      icon: <Users className="h-4 w-4" aria-hidden="true" />,
    },
    {
      label: t("admin.stat_needs"),
      value: needs.count,
      icon: <ListChecks className="h-4 w-4" aria-hidden="true" />,
    },
    {
      label: t("admin.stat_pledges"),
      value: pledges.count,
      icon: <Heart className="h-4 w-4" aria-hidden="true" />,
    },
    {
      label: t("admin.stat_unverified"),
      value: institutions.count,
      icon: <BadgeCheck className="h-4 w-4" aria-hidden="true" />,
    },
    {
      label: t("admin.claims_pending_stat"),
      value: claimQueue.error ? null : claimTotal,
      icon: <ShieldQuestion className="h-4 w-4" aria-hidden="true" />,
    },
  ];

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={t("admin.eyebrow")}
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
        <InstitutionClaimQueue claims={claims} total={claimTotal} renderedAt={Date.now()} />
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
