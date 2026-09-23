import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query, from } = vi.hoisted(() => {
  const query = {
    select: vi.fn(), gte: vi.fn(), order: vi.fn(), limit: vi.fn(),
    eq: vi.fn(), insert: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(),
  };
  return { query, from: vi.fn(() => query) };
});
vi.mock("@/lib/supabase/public", () => ({ createPublicSupabaseClient: () => ({ from }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    from, auth: { getUser: async () => ({ data: { user: { id: "user-id" } } }) },
  }),
}));
import { GET, POST } from "./route";

// Use the database schema as the contract, not the frontend's fixture shape.
const schema = readFileSync("supabase/migrations/001_initial_schema.sql", "utf8");
const columns = schema.split("create table public.volunteer_events (")[1]
  .split("\n);")[0].trim().split("\n").map((line) => line.trim().split(" ")[0]);
function expectDatabaseProjection() {
  const selection = query.select.mock.calls.find(([value]) => value.includes("event_date"))?.[0];
  expect(selection).toBeDefined();
  for (const field of selection.split(",institution:")[0].split(",")) {
    expect(columns).toContain(field);
  }
  expect(selection).toContain("address:public_address");
  expect(selection).not.toContain("*");
}

describe("volunteer event database projections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ALLOW_LOCAL_FIXTURES", "false");
    for (const method of [query.select, query.gte, query.order, query.eq, query.insert]) {
      method.mockReturnValue(query);
    }
    query.limit.mockResolvedValue({ data: [], error: null });
    query.single.mockResolvedValue({ data: { id: "event-id" }, error: null });
    query.maybeSingle.mockResolvedValue({ data: { role: "ngo", institution_id: "ngo-id" }, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("lists upcoming events using existing columns and a bounded public response", async () => {
    const response = await GET(new NextRequest("http://localhost/api/volunteer-events"));
    expect(response.status).toBe(200);
    expectDatabaseProjection();
    expect(query.gte).toHaveBeenCalledWith("event_date", expect.any(String));
    expect(query.limit).toHaveBeenCalledWith(30);
    expect(response.headers.get("cache-control")).toContain("public");
  });

  it("returns a newly created event using existing columns", async () => {
    const response = await POST(new NextRequest("http://localhost/api/volunteer-events", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ title: "Volontiranje", event_date: "2026-12-01", start_time: "10:00", end_time: "12:00" }),
    }));
    expect(response.status).toBe(200);
    expectDatabaseProjection();
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ institution_id: "ngo-id" }));
  });

  it("does not disguise database failures as an empty successful list", async () => {
    query.limit.mockResolvedValue({ data: null, error: { code: "42703" } });
    const response = await GET(new NextRequest("http://localhost/api/volunteer-events"));
    expect(response.status).toBe(503);
    expect((await response.json()).events).toBeUndefined();
  });
});
