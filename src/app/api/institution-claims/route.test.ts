import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` factories are hoisted above module scope, so the doubles are too.
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));

import { GET, POST } from "@/app/api/institution-claims/route";

const ACTOR = "11111111-2222-4333-8444-555555555555";

function anonymous() {
  getUser.mockResolvedValue({ data: { user: null } });
}

function signedIn(id = ACTOR) {
  getUser.mockResolvedValue({ data: { user: { id } } });
}

function post(body: unknown) {
  return new NextRequest("http://localhost/api/institution-claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = {
  udr_id: "200307",
  contact_email: "ured@udruga.hr",
  evidence_note: "Predsjednica udruge.",
};

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/institution-claims", () => {
  it("refuses an anonymous read before touching the database", async () => {
    anonymous();
    const response = await GET(new NextRequest("http://localhost/api/institution-claims"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the caller's own claim through the service-only RPC", async () => {
    signedIn();
    rpc.mockResolvedValue({ data: { id: "claim-1", status: "pending" }, error: null });
    const response = await GET(new NextRequest("http://localhost/api/institution-claims"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.claim.status).toBe("pending");
    expect(rpc).toHaveBeenCalledWith("get_own_institution_claim", { p_actor_id: ACTOR });
  });

  it("reports no claim rather than inventing one", async () => {
    signedIn();
    rpc.mockResolvedValue({ data: null, error: null });
    const payload = await (
      await GET(new NextRequest("http://localhost/api/institution-claims"))
    ).json();
    expect(payload.claim).toBeNull();
  });
});

describe("POST /api/institution-claims", () => {
  it("refuses an anonymous claim", async () => {
    anonymous();
    const response = await POST(post(VALID));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("validates the body before any database access", async () => {
    signedIn();
    for (const body of [
      { ...VALID, udr_id: "" },
      { ...VALID, contact_email: "not-an-email" },
      { ...VALID, evidence_note: "a".repeat(2001) },
    ]) {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the signed-in id as the actor, never a body-supplied one", async () => {
    signedIn();
    rpc.mockResolvedValue({ data: { id: "claim-1", status: "pending" }, error: null });
    const response = await POST(post({ ...VALID, profile_id: "someone-else" }));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("request_institution_claim_transaction", {
      p_actor_id: ACTOR,
      p_udr_id: "200307",
      p_contact_email: "ured@udruga.hr",
      p_note: "Predsjednica udruge.",
    });
  });

  it("maps a claim for an organisation outside the snapshot to 404", async () => {
    signedIn();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "organisation is not in the published registry snapshot" },
    });
    const response = await POST(post(VALID));
    expect(response.status).toBe(404);
    // The raw database message never reaches the browser.
    expect((await response.json()).error).not.toContain("snapshot");
  });

  it("maps a second open claim to a conflict", async () => {
    signedIn();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "an open claim already exists for this account" },
    });
    expect((await POST(post(VALID))).status).toBe(409);
  });

  it("maps a refused actor to 403", async () => {
    signedIn();
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    expect((await POST(post(VALID))).status).toBe(403);
  });
});
