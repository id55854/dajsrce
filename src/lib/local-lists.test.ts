import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createPublicSupabaseClient } = vi.hoisted(() => ({
  createPublicSupabaseClient: vi.fn(() => { throw new Error("Database unavailable"); }),
}));
vi.mock("@/lib/supabase/public", () => ({ createPublicSupabaseClient }));
import { GET as getNeeds } from "@/app/api/needs/route";
import { GET as getEvents } from "@/app/api/volunteer-events/route";

describe("explicit local list mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_LOCAL_FIXTURES", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("serves filtered and bounded needs without creating a database client", async () => {
    const response = await getNeeds(new NextRequest("http://localhost/api/needs?donation_type=food&urgency=urgent&limit=2"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.fixture).toBe(true);
    expect(body.needs).toHaveLength(2);
    expect(body.needs.every((need: { donation_type: string; urgency: string }) => need.donation_type === "food" && need.urgency === "urgent")).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(createPublicSupabaseClient).not.toHaveBeenCalled();
  });

  it("serves events without creating a database client", async () => {
    const response = await getEvents(new NextRequest("http://localhost/api/volunteer-events"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.fixture).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);
    expect(createPublicSupabaseClient).not.toHaveBeenCalled();
  });

  it.each(["production", "fixtures disabled"])("does not substitute fake data when %s", async (mode) => {
    if (mode === "production") vi.stubEnv("NODE_ENV", "production");
    else vi.stubEnv("ALLOW_LOCAL_FIXTURES", "false");
    for (const [path, handler] of [["needs", getNeeds], ["volunteer-events", getEvents]] as const) {
      const response = await handler(new NextRequest(`http://localhost/api/${path}`));
      expect(response.status).toBe(503);
      expect((await response.json()).fixture).toBeUndefined();
    }
    expect(createPublicSupabaseClient).toHaveBeenCalledTimes(2);
  });

  it("still rejects invalid filters in fixture mode", async () => {
    const response = await getNeeds(new NextRequest("http://localhost/api/needs?categories=unknown"));
    expect(response.status).toBe(400);
    expect(createPublicSupabaseClient).not.toHaveBeenCalled();
  });
});
