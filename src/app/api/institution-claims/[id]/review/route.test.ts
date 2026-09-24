import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getCurrentUserProfile } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getCurrentUserProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@/lib/auth/server", () => ({ getCurrentUserProfile }));

import { POST } from "@/app/api/institution-claims/[id]/review/route";

const CLAIM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const params = Promise.resolve({ id: CLAIM_ID });

function review(body: unknown) {
  return new NextRequest(`http://localhost/api/institution-claims/${CLAIM_ID}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function signedInAs(role: string) {
  getCurrentUserProfile.mockResolvedValue({
    id: "99999999-8888-4777-8666-555555555555",
    email: "a@b.hr",
    name: "Reviewer",
    role,
    institution_id: null,
  });
}

beforeEach(() => {
  rpc.mockReset();
  getCurrentUserProfile.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/institution-claims/[id]/review", () => {
  it("refuses an anonymous reviewer", async () => {
    getCurrentUserProfile.mockResolvedValue(null);
    const response = await POST(review({ decision: "approve" }), { params });
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a non-admin and never reaches the database", async () => {
    for (const role of ["individual", "ngo"]) {
      signedInAs(role);
      const response = await POST(review({ decision: "approve" }), { params });
      expect(response.status, role).toBe(403);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a reason when rejecting", async () => {
    signedInAs("superadmin");
    const response = await POST(review({ decision: "reject" }), { params });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an unknown decision", async () => {
    signedInAs("superadmin");
    expect((await POST(review({ decision: "maybe" }), { params })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("routes an approval to the approval transaction with the reviewer id", async () => {
    signedInAs("superadmin");
    rpc.mockResolvedValue({ data: { id: CLAIM_ID, status: "approved" }, error: null });
    const response = await POST(review({ decision: "approve", note: "Provjereno." }), { params });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("approve_institution_claim_transaction", {
      p_reviewer_id: "99999999-8888-4777-8666-555555555555",
      p_claim_id: CLAIM_ID,
      p_note: "Provjereno.",
    });
  });

  it("routes a rejection to the rejection transaction", async () => {
    signedInAs("superadmin");
    rpc.mockResolvedValue({ data: { id: CLAIM_ID, status: "rejected" }, error: null });
    await POST(review({ decision: "reject", note: "Nije dokazano." }), { params });
    expect(rpc).toHaveBeenCalledWith("reject_institution_claim_transaction", {
      p_reviewer_id: "99999999-8888-4777-8666-555555555555",
      p_claim_id: CLAIM_ID,
      p_note: "Nije dokazano.",
    });
  });

  it("still fails closed when the transaction itself refuses the reviewer", async () => {
    // The route check is convenience; the RPC re-reads profiles.role.
    signedInAs("superadmin");
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "reviewer is not an administrator" },
    });
    const response = await POST(review({ decision: "approve" }), { params });
    expect(response.status).toBe(403);
    expect((await response.json()).error).not.toContain("administrator");
  });

  it("maps an already-decided claim to a conflict", async () => {
    signedInAs("superadmin");
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "claim is no longer open" },
    });
    expect((await POST(review({ decision: "approve" }), { params })).status).toBe(409);
  });
});
