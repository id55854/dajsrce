import { redirect } from "next/navigation";
import { BadgeCheck, Heart, ListChecks, Users } from "lucide-react";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Card, PageHeader, PageShell, Stat } from "@/components/ui";

export default async function SuperadminDashboardPage() {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect("/auth/login?next=/dashboard/admin");
  if (profile.role !== "superadmin") redirect("/dashboard");

  const [profiles, needs, pledges, institutions] = await Promise.all([
    supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("needs").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("pledges").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("institutions")
      .select("id", { count: "exact", head: true })
      .eq("is_verified", false),
  ]);

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
  ];

  return (
    <PageShell width="wide">
      {/* The page used to promise "high-level moderation and platform
          operations" above four read-only numbers and nothing else. It now
          describes what it actually is. */}
      <PageHeader
        eyebrow="Superadmin"
        title="Platform counts"
        subtitle="Read-only totals across the whole platform, refreshed on each load."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <Card padding="lg" className="mt-8">
        <h2 className="text-lg font-semibold text-ink">No moderation tools here yet</h2>
        <p className="mt-2 text-base leading-7 text-ink-secondary">
          There are no review, verification or takedown controls on this page. NGO verification,
          registry promotion and notification jobs are operated from the CLI and scheduled
          workers described in the runbook, not from this dashboard. The counts above are the
          only thing this surface currently does.
        </p>
      </Card>
    </PageShell>
  );
}
