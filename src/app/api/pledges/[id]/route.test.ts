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

import { DELETE } from "@/app/api/pledges/[id]/route";

const PLEDGE_ID = "6b2b7f0e-1c3d-4a5b-9e7f-0a1b2c3d4e5f";
const DONOR_ID = "11111111-2222-3333-4444-555555555555";

function cancel(id = PLEDGE_ID) {
  return DELETE(
    new NextRequest(`http://localhost/api/pledges/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) }
  );
}

describe("DELETE /api/pledges/[id]", () => {
  beforeEach(() => {
    rpc.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: DONOR_ID } } });
  });

  it("withdraws the donor's own pledge through the transactional RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        pledge_id: PLEDGE_ID,
        status: "cancelled",
        released_quantity: 3,
        need: { id: "need", quantity_pledged: 0 },
      },
      error: null,
    });

    const response = await cancel();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.cancelled.status).toBe("cancelled");
    // The actor is taken from the session, never from the request.
    expect(rpc).toHaveBeenCalledWith("cancel_pledge_transaction", {
      p_actor_id: DONOR_ID,
      p_pledge_id: PLEDGE_ID,
    });
  });

  it("refuses a pledge that is already delivered or confirmed", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23514" } });
    const response = await cancel();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Pledge could not be cancelled");
  });

  it("refuses someone else's pledge", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await cancel()).status).toBe(403);
  });

  it("reports a missing pledge as not found", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    expect((await cancel()).status).toBe(404);
  });

  it("requires a session and a well-formed id before touching the database", async () => {
    expect((await cancel("not-a-uuid")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();

    getUser.mockResolvedValue({ data: { user: null } });
    expect((await cancel()).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("cancel_pledge_transaction contract", () => {
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
      /CREATE OR REPLACE FUNCTION public\.cancel_pledge_transaction\(\s*p_actor_id uuid,\s*p_pledge_id uuid\s*\)/i
    );
    const definitions = sql.match(/^\s*SECURITY DEFINER\s*$/gim)?.length ?? 0;
    const hardened =
      sql.match(/^\s*SECURITY DEFINER\s*\r?\n\s*SET search_path = pg_catalog,/gim)?.length ?? 0;
    expect(definitions).toBeGreaterThan(0);
    expect(hardened).toBe(definitions);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.cancel_pledge_transaction\(uuid, uuid\) FROM PUBLIC, anon, authenticated/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cancel_pledge_transaction\(uuid, uuid\) TO service_role/i
    );
  });

  it("decides ownership and evidence inside the locked transaction", () => {
    expect(sql).toContain("FROM public.pledges WHERE id = p_pledge_id FOR UPDATE");
    expect(sql).toContain("v_pledge.user_id IS DISTINCT FROM p_actor_id");
    expect(sql).toContain("delivered or confirmed pledges cannot be cancelled");
    expect(sql).toMatch(/RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'/);
  });

  it("releases the reserved quantity, the counter and the audit trail", () => {
    expect(sql).toContain("FROM public.needs WHERE id = v_pledge.need_id FOR UPDATE");
    expect(sql).toContain(
      "greatest(0, coalesce(v_need.quantity_pledged, 0) - v_released)"
    );
    expect(sql).toMatch(/is_fulfilled = CASE[\s\S]+v_new_pledged >= quantity_needed/i);
    expect(sql).toContain("greatest(0, coalesce(total_pledges, 0) - 1)");
    expect(sql).toMatch(/append_audit_log_event\([\s\S]+'pledge\.cancel'/i);
  });
});
