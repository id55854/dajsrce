import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted with the vi.mock factories below, which read them eagerly.
const { rpc, getUser, profile, eventRead, sendVolunteerEmail, afterTasks } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  profile: vi.fn(),
  eventRead: vi.fn(),
  sendVolunteerEmail: vi.fn(),
  afterTasks: [] as (() => unknown)[],
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // Collect instead of running, to prove the e-mail waits for the response.
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: table === "profiles" ? profile : eventRead,
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@/lib/email/volunteer-emails", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/volunteer-emails")>()),
  sendVolunteerEmail,
}));

import { POST } from "./route";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const EVENT = {
  id: EVENT_ID,
  title: "Podjela obroka",
  event_date: "2026-09-26",
  start_time: "09:00:00",
  end_time: "14:00:00",
  location: null,
  requirements: "Rukavice",
  contact_person: "Ana",
  contact_phone: "091 234 5678",
  institution: { name: "Udruga Srce", address: "Donji grad", city: "Zagreb" },
};

function signUp(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/volunteer-signups", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/volunteer-signups", () => {
  beforeEach(() => {
    rpc.mockReset();
    getUser.mockReset();
    profile.mockReset();
    eventRead.mockReset();
    sendVolunteerEmail.mockReset();
    afterTasks.length = 0;
    getUser.mockResolvedValue({ data: { user: { id: USER_ID, email: "volonter@example.com" } } });
    profile.mockResolvedValue({ data: { id: USER_ID, name: "Ivana" }, error: null });
    eventRead.mockResolvedValue({ data: EVENT, error: null });
    rpc.mockResolvedValue({ data: { id: "signup-id", event_id: EVENT_ID }, error: null });
    sendVolunteerEmail.mockResolvedValue("sent");
    // 12:00 in Zagreb, on the event's day.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T10:00:00Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("signs up through the transaction and confirms by e-mail after answering", async () => {
    const response = await signUp({ event_id: EVENT_ID, age_confirmed: true });
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("volunteer_signup_transaction", { p_user_id: USER_ID, p_event_id: EVENT_ID });
    // Nothing is sent before the response; the task is queued for after it.
    expect(sendVolunteerEmail).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);
    await afterTasks[0]();
    expect(sendVolunteerEmail).toHaveBeenCalledWith(
      "signup",
      expect.objectContaining({
        to: "volonter@example.com",
        recipientName: "Ivana",
        event: expect.objectContaining({
          id: EVENT_ID,
          title: "Podjela obroka",
          requirements: "Rukavice",
          contact_phone: "091 234 5678",
          institution_name: "Udruga Srce",
          institution_address: "Donji grad",
          institution_city: "Zagreb",
        }),
      }),
      expect.objectContaining({ requestId: expect.any(String) })
    );
  });

  it.each([undefined, false, "true", 1])("requires the explicit age confirmation (%s)", async (ageConfirmed) => {
    const response = await signUp({ event_id: EVENT_ID, age_confirmed: ageConfirmed });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "age_confirmation_required" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a same-day event whose end time has passed, with the ended code", async () => {
    eventRead.mockResolvedValue({ data: { ...EVENT, end_time: "11:30:00" }, error: null });
    const response = await signUp({ event_id: EVENT_ID, age_confirmed: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "event_ended" });
    expect(rpc).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(0);
  });

  it("reports a missing event and fails closed when the event cannot be read", async () => {
    eventRead.mockResolvedValue({ data: null, error: null });
    expect((await signUp({ event_id: EVENT_ID, age_confirmed: true })).status).toBe(404);
    eventRead.mockResolvedValue({ data: null, error: { code: "57014" } });
    expect((await signUp({ event_id: EVENT_ID, age_confirmed: true })).status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the transaction's capacity refusals through, without an e-mail", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "event is full" } });
    const response = await signUp({ event_id: EVENT_ID, age_confirmed: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "event_full" });
    expect(afterTasks).toHaveLength(0);
  });

  it("keeps the signup when the e-mail fails", async () => {
    sendVolunteerEmail.mockRejectedValue(new Error("never thrown in practice"));
    const response = await signUp({ event_id: EVENT_ID, age_confirmed: true });
    expect(response.status).toBe(201);
  });

  it("requires a session and a well-formed event id", async () => {
    expect((await signUp({ event_id: "nope", age_confirmed: true })).status).toBe(400);
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await signUp({ event_id: EVENT_ID, age_confirmed: true })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
