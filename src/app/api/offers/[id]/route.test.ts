import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` factories are hoisted above the module scope, so the doubles have
// to be hoisted with them.
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));

import { PATCH } from "@/app/api/offers/[id]/route";
import { POST as CLAIM } from "@/app/api/offers/[id]/claims/route";

const OFFER_ID = "0f2b9d3c-6b4a-4f57-9a8a-1f2c3d4e5f60";
const ACTOR = "11111111-2222-4333-8444-555555555555";

function params(id = OFFER_ID) {
  return { params: Promise.resolve({ id }) };
}

function patch(body: unknown, id = OFFER_ID) {
  return new NextRequest(`http://localhost/api/offers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function claimRequest(body: unknown, id = OFFER_ID) {
  return new NextRequest(`http://localhost/api/offers/${id}/claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PATCH /api/offers/[id]", () => {
  it("rejects an identifier that is not a UUID before any work", async () => {
    const response = await PATCH(patch({ status: "withdrawn" }, "../../etc"), params("../../etc"));
    expect(response.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await PATCH(patch({ status: "withdrawn" }), params());
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a status the author is not allowed to set", async () => {
    const response = await PATCH(patch({ status: "claimed" }), params());
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("withdraws through the transactional RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: ACTOR } } });
    rpc.mockResolvedValue({
      data: { id: OFFER_ID, status: "withdrawn", city: "Split", claims: [] },
      error: null,
    });
    const response = await PATCH(patch({ status: "withdrawn" }), params());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_donor_offer_status_transaction", {
      p_actor_id: ACTOR,
      p_offer_id: OFFER_ID,
      p_status: "withdrawn",
    });
  });

  it("turns a non-author withdrawal into 403 — ownership is decided in the RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "22222222-2222-4333-8444-555555555555" } } });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    const response = await PATCH(patch({ status: "withdrawn" }), params());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Offer could not be updated" });
  });

  it("sends field edits to the update RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: ACTOR } } });
    rpc.mockResolvedValue({ data: { id: OFFER_ID, status: "open", claims: [] }, error: null });
    await PATCH(patch({ title: "Perilica rublja", available_until: null }), params());
    expect(rpc).toHaveBeenCalledWith(
      "update_donor_offer_transaction",
      expect.objectContaining({
        p_actor_id: ACTOR,
        p_offer_id: OFFER_ID,
        p_title: "Perilica rublja",
        p_clear_available_until: true,
      })
    );
  });
});

describe("POST /api/offers/[id]/claims", () => {
  it("requires authentication", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await CLAIM(claimRequest({}), params());
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an unverified organisation with 403 and no claim row", async () => {
    getUser.mockResolvedValue({ data: { user: { id: ACTOR } } });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "organisation is not verified" },
    });
    const response = await CLAIM(claimRequest({ message: "Trebamo za obitelj." }), params());
    expect(response.status).toBe(403);
    expect(rpc).toHaveBeenCalledWith("claim_donor_offer_transaction", {
      p_actor_id: ACTOR,
      p_offer_id: OFFER_ID,
      p_message: "Trebamo za obitelj.",
    });
    // The route never inspects a role itself; the refusal came from the RPC.
    expect(await response.json()).toMatchObject({ error: "Offer could not be claimed" });
  });

  it("refuses a profile with no organisation at all", async () => {
    getUser.mockResolvedValue({ data: { user: { id: ACTOR } } });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "organisation membership required" },
    });
    const response = await CLAIM(claimRequest({}), params());
    expect(response.status).toBe(403);
  });

  it("bounds the claim message", async () => {
    const response = await CLAIM(claimRequest({ message: "x".repeat(1001) }), params());
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records a verified organisation's request", async () => {
    getUser.mockResolvedValue({ data: { user: { id: ACTOR } } });
    rpc.mockResolvedValue({
      data: {
        id: "aaaaaaaa-2222-4333-8444-555555555555",
        offer_id: OFFER_ID,
        institution_id: "bbbbbbbb-2222-4333-8444-555555555555",
        status: "requested",
        message: null,
        created_at: "2026-08-12T09:00:00Z",
        responded_at: null,
        // Never forwarded: the requesting staff member's profile id.
        claimed_by: ACTOR,
      },
      error: null,
    });
    const response = await CLAIM(claimRequest({}), params());
    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(payload.claim.status).toBe("requested");
    expect(payload.claim).not.toHaveProperty("claimed_by");
  });
});
