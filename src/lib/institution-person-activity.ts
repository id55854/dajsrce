import type { SupabaseClient } from "@supabase/supabase-js";

/** Standing pledges and active volunteer signups, per person. */
export type PersonActivity = { pledges: number; signups: number };

/**
 * What each person on an organisation's roster has done with that
 * organisation: standing pledges to its needs and active signups for its
 * events. Shown in the small person dialog so the organisation can tell a
 * newcomer from a regular of its own.
 *
 * Nothing about any other organisation is counted or returned. The caller
 * passes its own RLS-scoped client, which can only read pledges for the
 * organisation's needs and signups for its events, and the explicit
 * institution filter says the same thing in the query.
 */
export async function institutionPersonActivity(
  client: SupabaseClient,
  institutionId: string,
  userIds: readonly string[]
): Promise<Record<string, PersonActivity>> {
  const activity: Record<string, PersonActivity> = {};
  if (userIds.length === 0) return activity;
  for (const id of userIds) activity[id] = { pledges: 0, signups: 0 };

  const [pledges, signups] = await Promise.all([
    client
      .from("pledges")
      .select("user_id, need:needs!inner(institution_id)")
      .in("user_id", userIds)
      .eq("need.institution_id", institutionId)
      .neq("status", "cancelled"),
    client
      .from("volunteer_signups")
      .select("user_id, event:volunteer_events!inner(institution_id)")
      .in("user_id", userIds)
      .eq("event.institution_id", institutionId)
      .is("cancelled_at", null),
  ]);

  for (const row of (pledges.data ?? []) as { user_id: string }[]) {
    if (activity[row.user_id]) activity[row.user_id].pledges += 1;
  }
  for (const row of (signups.data ?? []) as { user_id: string }[]) {
    if (activity[row.user_id]) activity[row.user_id].signups += 1;
  }
  return activity;
}

/**
 * The same totals across every organisation, read with the service client.
 *
 * @deprecated An organisation should only see its own relationship with a
 * person (VOL-12); use institutionPersonActivity. Kept only until the pledge
 * roster route moves over.
 */
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
