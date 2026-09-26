import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted with the vi.mock factories below, which read them eagerly.
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));

import { PATCH } from "@/app/api/volunteer-events/[id]/route";

const EVENT_ID = "9c8b7a6d-5e4f-4321-8abc-0123456789ab";
const NGO_USER = "22222222-3333-4444-5555-666666666666";

function edit(body: unknown, id = EVENT_ID) {
  return PATCH(
    new NextRequest(`http://localhost/api/volunteer-events/${id}`, {
      method: "PATCH",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

describe("PATCH /api/volunteer-events/[id]", () => {
  beforeEach(() => {
    rpc.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: NGO_USER } } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T10:00:00Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends only the validated changes to the transaction, as the signed-in actor", async () => {
    rpc.mockResolvedValue({ data: { id: EVENT_ID, title: "Novi naziv", volunteers_needed: 8 }, error: null });
    const response = await edit({ title: " Novi naziv ", volunteers_needed: 8, contact_phone: "" });
    expect(response.status).toBe(200);
    expect((await response.json()).event).toMatchObject({ id: EVENT_ID, title: "Novi naziv" });
    expect(rpc).toHaveBeenCalledWith("update_volunteer_event_transaction", {
      p_actor_id: NGO_USER,
      p_event_id: EVENT_ID,
      p_patch: { title: "Novi naziv", volunteers_needed: 8, contact_phone: null },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses fields an organisation may not set, before the database", async () => {
    const response = await edit({ title: "Naziv", institution_id: "11111111-1111-4111-8111-111111111111" });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("names the field that failed validation, including a past date", async () => {
    const response = await edit({ event_date: "2026-09-25" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: "event_date" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "42501", message: "forbidden" }, 403, undefined],
    [{ code: "P0002", message: "event not found" }, 404, undefined],
    [{ code: "23514", message: "volunteers_needed is below the active signups" }, 409, "capacity_below_signups"],
    [{ code: "23514", message: "event has already ended" }, 409, "event_ended"],
    [{ code: "PGRST202", message: "function not found" }, 500, undefined],
  ])("maps the transaction's refusal %o to %i", async (error, status, code) => {
    rpc.mockResolvedValue({ data: null, error });
    const response = await edit({ volunteers_needed: 2 });
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error).toBe("Event could not be updated");
    expect(body.code).toBe(code);
    // The raw database message never reaches the browser.
    expect(JSON.stringify(body)).not.toContain(error.message);
  });

  it("points a database validation refusal at the field it names", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "end_time must be after start_time" } });
    const response = await edit({ end_time: "08:00" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: "end_time" });
  });

  it("requires a session, a well-formed id, JSON and the same origin", async () => {
    expect((await edit({ title: "Naziv" }, "42")).status).toBe(400);
    expect((await edit("{not json")).status).toBe(400);
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await edit({ title: "Naziv" })).status).toBe(401);
    const crossSite = await PATCH(
      new NextRequest(`http://localhost/api/volunteer-events/${EVENT_ID}`, {
        method: "PATCH",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ title: "Naziv" }),
      }),
      { params: Promise.resolve({ id: EVENT_ID }) }
    );
    expect(crossSite.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
