import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { institutionPersonActivity } from "./institution-person-activity";

/** A query builder that records every filter and answers with fixed rows. */
function fakeClient(rows: Record<string, { user_id: string }[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "in", "eq", "neq", "is"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows[table] ?? [], error: null });
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("institutionPersonActivity", () => {
  it("counts only pledges to this organisation's needs and signups for its events", async () => {
    const { client, calls } = fakeClient({
      pledges: [{ user_id: "a" }, { user_id: "a" }, { user_id: "b" }],
      volunteer_signups: [{ user_id: "a" }],
    });
    const activity = await institutionPersonActivity(client, "inst-1", ["a", "b"]);
    expect(activity).toEqual({ a: { pledges: 2, signups: 1 }, b: { pledges: 1, signups: 0 } });
    expect(calls).toContainEqual({ table: "pledges", method: "eq", args: ["need.institution_id", "inst-1"] });
    expect(calls).toContainEqual({ table: "volunteer_signups", method: "eq", args: ["event.institution_id", "inst-1"] });
    expect(calls).toContainEqual({ table: "pledges", method: "neq", args: ["status", "cancelled"] });
    expect(calls).toContainEqual({ table: "volunteer_signups", method: "is", args: ["cancelled_at", null] });
    // Inner embeds, so the institution filter removes rows instead of nulling the embed.
    expect(calls.find((call) => call.table === "pledges" && call.method === "select")?.args[0]).toContain("needs!inner");
    expect(calls.find((call) => call.table === "volunteer_signups" && call.method === "select")?.args[0]).toContain("volunteer_events!inner");
  });

  it("ignores rows for people outside the roster and reads nothing for an empty one", async () => {
    const { client, calls } = fakeClient({ pledges: [{ user_id: "stranger" }], volunteer_signups: [] });
    expect(await institutionPersonActivity(client, "inst-1", ["a"])).toEqual({ a: { pledges: 0, signups: 0 } });
    calls.length = 0;
    expect(await institutionPersonActivity(client, "inst-1", [])).toEqual({});
    expect(calls).toEqual([]);
  });
});
