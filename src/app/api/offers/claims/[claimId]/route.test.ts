import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` factories are hoisted above the module scope, so the doubles have
// to be hoisted with them.
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));

import { PATCH } from "@/app/api/offers/claims/[claimId]/route";

const CLAIM_ID = "aaaaaaaa-2222-4333-8444-555555555555";
const OFFER_ID = "0f2b9d3c-6b4a-4f57-9a8a-1f2c3d4e5f60";
const AUTHOR = "11111111-2222-4333-8444-555555555555";

function params(claimId = CLAIM_ID) {
  return { params: Promise.resolve({ claimId }) };
}

function patch(body: unknown, claimId = CLAIM_ID) {
  return new NextRequest(`http://localhost/api/offers/claims/${claimId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PATCH /api/offers/claims/[claimId]", () => {
  it("rejects a malformed claim identifier before any work", async () => {
    const response = await PATCH(patch({ decision: "accepted" }, "nope"), params("nope"));
    expect(response.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await PATCH(patch({ decision: "accepted" }), params());
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a decision outside the terminal vocabulary", async () => {
    const response = await PATCH(patch({ decision: "requested" }), params());
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts one claim and reports the others declined in the same transaction", async () => {
    getUser.mockResolvedValue({ data: { user: { id: AUTHOR } } });
    rpc.mockResolvedValue({
      data: {
        claim: {
          id: CLAIM_ID,
          offer_id: OFFER_ID,
          institution_id: "bbbbbbbb-2222-4333-8444-555555555555",
          status: "accepted",
          responded_at: "2026-08-12T10:00:00Z",
        },
        offer: {
          id: OFFER_ID,
          title: "Perilica rublja",
          city: "Split",
          status: "claimed",
          claimed_institution_id: "bbbbbbbb-2222-4333-8444-555555555555",
          claims: [],
        },
        declined_others: 3,
      },
      error: null,
    });

    const response = await PATCH(patch({ decision: "accepted" }), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("respond_to_offer_claim_transaction", {
      p_actor_id: AUTHOR,
      p_claim_id: CLAIM_ID,
      p_decision: "accepted",
    });
    // One RPC round trip settled the accepted claim, the sibling claims and
    // the offer's status — the route never issues a follow-up write.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(payload.claim.status).toBe("accepted");
    expect(payload.declined_others).toBe(3);
    expect(payload.offer.status).toBe("claimed");
  });

  it("declines without touching the offer's status", async () => {
    getUser.mockResolvedValue({ data: { user: { id: AUTHOR } } });
    rpc.mockResolvedValue({
      data: {
        claim: { id: CLAIM_ID, offer_id: OFFER_ID, status: "declined", responded_at: "x" },
        offer: { id: OFFER_ID, status: "open", claims: [] },
        declined_others: 0,
      },
      error: null,
    });
    const response = await PATCH(patch({ decision: "declined" }), params());
    const payload = await response.json();
    expect(payload.claim.status).toBe("declined");
    expect(payload.offer.status).toBe("open");
    expect(payload.declined_others).toBe(0);
  });

  it("turns a non-author decision into 403 — authorship is decided in the RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "22222222-2222-4333-8444-555555555555" } } });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    const response = await PATCH(patch({ decision: "accepted" }), params());
    expect(response.status).toBe(403);
  });

  it("reports an already-answered claim as a conflict", async () => {
    getUser.mockResolvedValue({ data: { user: { id: AUTHOR } } });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "claim has already been answered" },
    });
    const response = await PATCH(patch({ decision: "accepted" }), params());
    expect(response.status).toBe(409);
  });

  it("sends an organisation's withdrawal to its own RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: AUTHOR } } });
    rpc.mockResolvedValue({
      data: { id: CLAIM_ID, offer_id: OFFER_ID, status: "withdrawn", responded_at: "x" },
      error: null,
    });
    const response = await PATCH(patch({ decision: "withdrawn" }), params());
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("withdraw_offer_claim_transaction", {
      p_actor_id: AUTHOR,
      p_claim_id: CLAIM_ID,
    });
    expect(payload.claim.status).toBe("withdrawn");
    expect(payload.offer).toBeNull();
  });
});
