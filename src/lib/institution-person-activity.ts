import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How active each person is on the platform: standing pledges and active
 * volunteer signups, across every organisation. Shown in the small person
 * dialog on an NGO's rosters so it can see whether someone is new or a
 * regular.
 *
 * Only the two totals leave this function: never which organisations, needs
 * or events they belong to. Reading other organisations' rows needs the
 * service client (RLS scopes an NGO to its own), so callers pass it and only
 * for people already on that NGO's own roster.
 */
export type PersonActivity = { pledges: number; signups: number };

export async function personActivityTotals(
  admin: SupabaseClient,
  userIds: readonly string[]
): Promise<Record<string, PersonActivity>> {
  const activity: Record<string, PersonActivity> = {};
  if (userIds.length === 0) return activity;
  for (const id of userIds) activity[id] = { pledges: 0, signups: 0 };

  const [pledges, signups] = await Promise.all([
    admin.from("pledges").select("user_id").in("user_id", userIds).neq("status", "cancelled"),
    admin.from("volunteer_signups").select("user_id").in("user_id", userIds).is("cancelled_at", null),
  ]);

  for (const row of (pledges.data ?? []) as { user_id: string }[]) {
    if (activity[row.user_id]) activity[row.user_id].pledges += 1;
  }
  for (const row of (signups.data ?? []) as { user_id: string }[]) {
    if (activity[row.user_id]) activity[row.user_id].signups += 1;
  }
  return activity;
}
