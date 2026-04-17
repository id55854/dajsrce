import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function SuperadminDashboardPage() {
  const supabase = await createServerSupabaseClient();

  const [profiles, needs, pledges, institutions] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("needs").select("id", { count: "exact", head: true }),
    supabase.from("pledges").select("id", { count: "exact", head: true }),
    supabase
      .from("institutions")
      .select("id", { count: "exact", head: true })
      .eq("is_verified", false),
  ]);

  const cards = [
    { label: "Users", value: profiles.count ?? 0 },
    { label: "Active needs", value: needs.count ?? 0 },
    { label: "Donations", value: pledges.count ?? 0 },
    { label: "Unverified NGOs", value: institutions.count ?? 0 },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        Superadmin Dashboard
      </h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        High-level moderation and platform operations.
      </p>
      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900"
          >
            <p className="text-xs uppercase tracking-wide text-gray-500">{card.label}</p>
            <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100">
              {card.value}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
