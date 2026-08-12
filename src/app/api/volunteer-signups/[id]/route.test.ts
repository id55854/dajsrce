import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted with the vi.mock factories below, which read them eagerly.
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc },
}));

import { DELETE } from "@/app/api/volunteer-signups/[id]/route";

const SIGNUP_ID = "9c8b7a6d-5e4f-4321-8abc-0123456789ab";
const VOLUNTEER_ID = "22222222-3333-4444-5555-666666666666";

function cancel(id = SIGNUP_ID) {
  return DELETE(
    new NextRequest(`http://localhost/api/volunteer-signups/${id}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id }) }
  );
}

describe("DELETE /api/volunteer-signups/[id]", () => {
  beforeEach(() => {
    rpc.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: VOLUNTEER_ID } } });
  });

  it("withdraws the volunteer's own signup through the transactional RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        signup_id: SIGNUP_ID,
        cancelled_at: "2026-08-12T10:00:00.000Z",
        event: { id: "event", volunteers_signed_up: 4 },
      },
      error: null,
    });

    const response = await cancel();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.cancelled.event.volunteers_signed_up).toBe(4);
    expect(rpc).toHaveBeenCalledWith("cancel_volunteer_signup_transaction", {
      p_actor_id: VOLUNTEER_ID,
      p_signup_id: SIGNUP_ID,
    });
  });

  it("refuses a signup whose attendance is already recorded", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23514" } });
    const response = await cancel();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Signup could not be cancelled");
  });

  it("refuses someone else's signup", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await cancel()).status).toBe(403);
  });

  it("reports a missing signup as not found", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    expect((await cancel()).status).toBe(404);
  });

  it("requires a session and a well-formed id before touching the database", async () => {
    expect((await cancel("42")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();

    getUser.mockResolvedValue({ data: { user: null } });
    expect((await cancel()).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("cancel_volunteer_signup_transaction contract", () => {
  const sql = readFileSync(
    path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260812110000_cancel_pledges_and_signups.sql"
    ),
    "utf8"
  );

  it("stays a hardened, service-only transactional RPC", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.cancel_volunteer_signup_transaction\(\s*p_actor_id uuid,\s*p_signup_id uuid\s*\)/i
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.cancel_volunteer_signup_transaction\(uuid, uuid\) FROM PUBLIC, anon, authenticated/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cancel_volunteer_signup_transaction\(uuid, uuid\) TO service_role/i
    );
  });

  it("never deletes a signup row, because volunteer_hours cascades from it", () => {
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.volunteer_signups/i);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS cancelled_at timestamptz");
    expect(sql).toContain("volunteer_signups_cancel_before_attendance");
  });

  it("refuses cancellation once the volunteer has checked in", () => {
    expect(sql).toContain("v_signup.user_id IS DISTINCT FROM p_actor_id");
    expect(sql).toMatch(
      /v_signup\.checked_in_at IS NOT NULL OR v_signup\.checked_out_at IS NOT NULL/
    );
    expect(sql).toContain("attendance already recorded");
    expect(sql).toContain("signup was cancelled");
  });

  it("releases the seat under lock and never below zero", () => {
    expect(sql).toContain(
      "FROM public.volunteer_events WHERE id = v_signup.event_id FOR UPDATE"
    );
    expect(sql).toContain(
      "volunteers_signed_up = greatest(0, coalesce(volunteers_signed_up, 0) - 1)"
    );
    // A freed seat is bookable again: capacity ignores cancelled rows.
    expect(sql).toContain("WHERE event_id = p_event_id AND cancelled_at IS NULL");
  });
});
