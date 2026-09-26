import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from, getUser, getCurrentUserProfile } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  getCurrentUserProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc, from } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));
// The locally verified profile read must not be what authorises a review.
vi.mock("@/lib/auth/server", () => ({ getCurrentUserProfile }));

import { POST } from "@/app/api/institution-claims/[id]/review/route";

const CLAIM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REVIEWER_ID = "99999999-8888-4777-8666-555555555555";
const params = Promise.resolve({ id: CLAIM_ID });

function review(body: unknown) {
  return new NextRequest(`http://localhost/api/institution-claims/${CLAIM_ID}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function signedInAs(role: string) {
  getUser.mockResolvedValue({ data: { user: { id: REVIEWER_ID, email: "a@b.hr" } } });
  from.mockImplementation((table: string) => {
    expect(table).toBe("profiles");
    return {
      select: (columns: string) => {
        expect(columns).toBe("role");
        return {
          eq: (column: string, value: string) => {
            expect([column, value]).toEqual(["id", REVIEWER_ID]);
            return { maybeSingle: async () => ({ data: { role }, error: null }) };
          },
        };
      },
    };
  });
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  getUser.mockReset();
  getCurrentUserProfile.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/institution-claims/[id]/review", () => {
  it("refuses an anonymous reviewer", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await POST(review({ decision: "approve" }), { params });
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("authorises from auth.getUser(), not from locally verified claims", async () => {
    // A session revoked elsewhere still verifies locally until it expires;
    // getUser() is the round trip that notices.
    getCurrentUserProfile.mockResolvedValue({ id: REVIEWER_ID, role: "superadmin" });
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await POST(review({ decision: "approve" }), { params });
    expect(response.status).toBe(401);
    expect(getCurrentUserProfile).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a non-admin and never reaches the transaction", async () => {
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

  it("routes an approval to the approval transaction with the getUser() id", async () => {
    signedInAs("superadmin");
    rpc.mockResolvedValue({ data: { id: CLAIM_ID, status: "approved" }, error: null });
    const response = await POST(
      review({ decision: "approve", note: "Provjereno: telefonom s predsjednicom." }),
      { params }
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("approve_institution_claim_transaction", {
      p_reviewer_id: REVIEWER_ID,
      p_claim_id: CLAIM_ID,
      p_note: "Provjereno: telefonom s predsjednicom.",
    });
  });

  it("routes a rejection to the rejection transaction", async () => {
    signedInAs("superadmin");
    rpc.mockResolvedValue({ data: { id: CLAIM_ID, status: "rejected" }, error: null });
    await POST(review({ decision: "reject", note: "Nije dokazano." }), { params });
    expect(rpc).toHaveBeenCalledWith("reject_institution_claim_transaction", {
      p_reviewer_id: REVIEWER_ID,
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

  it("maps an already-decided claim to a conflict with a stable code", async () => {
    signedInAs("superadmin");
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "claim is no longer open" },
    });
    const response = await POST(review({ decision: "approve" }), { params });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("claim_closed");
  });

  it("names an approval refused for an unconfirmed mailbox", async () => {
    signedInAs("superadmin");
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "claim cannot be approved: mailbox not verified" },
    });
    const response = await POST(review({ decision: "approve" }), { params });
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.code).toBe("mailbox_not_verified");
    expect(payload.error).not.toContain("mailbox");
  });
});
