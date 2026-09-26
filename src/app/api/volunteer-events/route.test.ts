import { readdirSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query, list, from, notifyNearbyUsers } = vi.hoisted(() => {
  // Awaiting the list query resolves `list.result`, like the real builder,
  // which stays chainable after .limit().
  const list: { result: { data: unknown; error: unknown } } = { result: { data: [], error: null } };
  const query = {
    select: vi.fn(), gte: vi.fn(), or: vi.fn(), order: vi.fn(), limit: vi.fn(),
    eq: vi.fn(), insert: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(list.result).then(resolve, reject),
  };
  return { query, list, from: vi.fn(() => query), notifyNearbyUsers: vi.fn() };
});
vi.mock("@/lib/supabase/public", () => ({ createPublicSupabaseClient: () => ({ from }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    from, auth: { getUser: async () => ({ data: { user: { id: "user-id" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/notify-nearby", () => ({ notifyNearbyUsers }));
import { GET, POST } from "./route";

// Use the database schema as the contract, not the frontend's fixture shape.
const schema = readFileSync("supabase/migrations/001_initial_schema.sql", "utf8");
const columns = schema.split("create table public.volunteer_events (")[1]
  .split("\n);")[0].trim().split("\n").map((line) => line.trim().split(" ")[0]);
// Columns later migrations add to the table are part of the same contract.
for (const file of readdirSync("supabase/migrations")) {
  const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
  for (const match of sql.matchAll(/ALTER TABLE public\.volunteer_events\s+ADD COLUMN IF NOT EXISTS (\w+)/gi)) {
    columns.push(match[1]);
  }
}
function expectDatabaseProjection() {
  const selection = query.select.mock.calls.find(([value]) => value.includes("event_date"))?.[0];
  expect(selection).toBeDefined();
  for (const field of selection.split(",institution:")[0].split(",")) {
    expect(columns).toContain(field);
  }
  expect(selection).toContain("address:public_address");
  expect(selection).not.toContain("*");
}

function create(body: Record<string, unknown>) {
  return POST(new NextRequest("http://localhost/api/volunteer-events", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

const NEW_EVENT = { title: "Volontiranje", event_date: "2026-12-01", start_time: "10:00", end_time: "12:00" };

describe("volunteer event database projections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ALLOW_LOCAL_FIXTURES", "false");
    // 12:00 in Zagreb on 26 September 2026.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T10:00:00Z"));
    for (const method of [query.select, query.gte, query.or, query.order, query.limit, query.eq, query.insert]) {
      method.mockReturnValue(query);
    }
    list.result = { data: [], error: null };
    query.single.mockResolvedValue({ data: { id: "event-id" }, error: null });
    query.maybeSingle.mockResolvedValue({ data: { role: "ngo", institution_id: "ngo-id" }, error: null });
    notifyNearbyUsers.mockResolvedValue("job-id");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("lists upcoming events using existing columns and a bounded public response", async () => {
    const response = await GET(new NextRequest("http://localhost/api/volunteer-events"));
    expect(response.status).toBe(200);
    expectDatabaseProjection();
    expect(query.gte).toHaveBeenCalledWith("event_date", "2026-09-26");
    expect(query.limit).toHaveBeenCalledWith(101);
    expect(response.headers.get("cache-control")).toContain("public");
    expect(await response.json()).toMatchObject({ events: [], truncated: false });
  });

  it("drops today's events once their end time has passed in Croatia", async () => {
    await GET(new NextRequest("http://localhost/api/volunteer-events"));
    expect(query.or).toHaveBeenCalledWith('event_date.gt.2026-09-26,end_time.gt."12:00"');
  });

  it("uses the Croatian date after midnight, not the UTC one", async () => {
    vi.setSystemTime(new Date("2026-09-26T22:30:00Z"));
    await GET(new NextRequest("http://localhost/api/volunteer-events"));
    expect(query.gte).toHaveBeenCalledWith("event_date", "2026-09-27");
    expect(query.or).toHaveBeenCalledWith('event_date.gt.2026-09-27,end_time.gt."00:30"');
  });

  it("says when there are more upcoming events than one page", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({ id: `event-${index}` }));
    list.result = { data: rows, error: null };
    const body = await (await GET(new NextRequest("http://localhost/api/volunteer-events"))).json();
    expect(body.truncated).toBe(true);
    expect(body.events).toHaveLength(100);
  });

  it("narrows to one event for a visitor back from sign-in, and validates the id", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect((await GET(new NextRequest(`http://localhost/api/volunteer-events?event_id=${id}`))).status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("id", id);
    const invalid = await GET(new NextRequest("http://localhost/api/volunteer-events?event_id=nope"));
    expect(invalid.status).toBe(400);
  });

  it("returns a newly created event using existing columns", async () => {
    const response = await create(NEW_EVENT);
    expect(response.status).toBe(200);
    expectDatabaseProjection();
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ institution_id: "ngo-id" }));
  });

  it("stores what volunteers need to know and whom to contact", async () => {
    await create({
      ...NEW_EVENT,
      requirements: "Rukavice",
      contact_person: "Ana Horvat",
      contact_phone: "091 234 5678",
    });
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      requirements: "Rukavice",
      contact_person: "Ana Horvat",
      contact_phone: "091 234 5678",
    }));
  });

  it("refuses an event dated before today and names the field", async () => {
    const response = await create({ ...NEW_EVENT, event_date: "2026-09-25" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: "event_date" });
    expect(query.insert).not.toHaveBeenCalled();
  });

  it("queues the nearby notice in Croatian, without the register's capitals", async () => {
    query.single.mockResolvedValue({
      data: { id: "event-id", institution: { name: "UDRUGA SRCE", lat: 45.8, lng: 15.97 } },
      error: null,
    });
    await create(NEW_EVENT);
    expect(notifyNearbyUsers).toHaveBeenCalledWith(
      expect.anything(), 45.8, 15.97,
      "Volonterski događaj: Volontiranje",
      'Udruga Srce u vašoj blizini traži volontere za "Volontiranje" 1. prosinca 2026.',
      "/volunteer", "user-id", "volunteer-event:event-id"
    );
  });

  it("still reports a published event when the notification queue fails", async () => {
    query.single.mockResolvedValue({
      data: { id: "event-id", institution: { name: "Udruga", lat: 45.8, lng: 15.97 } },
      error: null,
    });
    notifyNearbyUsers.mockRejectedValue(new Error("queue down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await create(NEW_EVENT);
    expect(response.status).toBe(200);
    expect((await response.json()).event.id).toBe("event-id");
  });

  it("does not disguise database failures as an empty successful list", async () => {
    list.result = { data: null, error: { code: "42703" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(new NextRequest("http://localhost/api/volunteer-events"));
    expect(response.status).toBe(503);
    expect((await response.json()).events).toBeUndefined();
  });
});
