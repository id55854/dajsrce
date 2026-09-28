import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from, getUser, getClaims, getCurrentUserProfile } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  getClaims: vi.fn(),
  getCurrentUserProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc, from } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser, getClaims } }),
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

const VERIFIED_TOTP = { id: "factor-1", factor_type: "totp", status: "verified" };

/**
 * A reviewer as auth.getUser() returns them, with the factor list from
 * Supabase Auth, and a session at `aal`. By default an administrator who
 * has two-step sign-in on and used it for this session.
 */
function signedInAs(
  role: string,
  { aal = "aal2", factors = [VERIFIED_TOTP] }: { aal?: string; factors?: unknown[] } = {}
) {
  getUser.mockResolvedValue({ data: { user: { id: REVIEWER_ID, email: "a@b.hr", factors } } });
  getClaims.mockResolvedValue({ data: { claims: { sub: REVIEWER_ID, aal } }, error: null });
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
  getClaims.mockReset();
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

  describe("two-step sign-in, mandatory for administrators", () => {
    it("refuses an administrator whose session has not used the authenticator app", async () => {
      signedInAs("superadmin", { aal: "aal1" });
      const response = await POST(review({ decision: "approve" }), { params });
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.json()).code).toBe("mfa_required");
      expect(rpc).not.toHaveBeenCalled();
    });

    it("refuses an administrator who has not turned it on at all", async () => {
      for (const factors of [[], [{ id: "f", factor_type: "totp", status: "unverified" }]]) {
        signedInAs("superadmin", { aal: "aal1", factors });
        const response = await POST(review({ decision: "approve" }), { params });
        expect(response.status).toBe(403);
        expect((await response.json()).code).toBe("mfa_required");
      }
      expect(rpc).not.toHaveBeenCalled();
    });

    it("refuses an aal2 token once Supabase no longer lists the factor", async () => {
      // A removed factor leaves the current token at aal2 until it expires.
      signedInAs("superadmin", { aal: "aal2", factors: [] });
      const response = await POST(review({ decision: "approve" }), { params });
      expect((await response.json()).code).toBe("mfa_required");
      expect(rpc).not.toHaveBeenCalled();
    });

    it("refuses a session whose verified token belongs to someone else", async () => {
      signedInAs("superadmin");
      getClaims.mockResolvedValue({
        data: { claims: { sub: "11111111-2222-4333-8444-555555555555", aal: "aal2" } },
        error: null,
      });
      const response = await POST(review({ decision: "approve" }), { params });
      expect((await response.json()).code).toBe("mfa_required");
      expect(rpc).not.toHaveBeenCalled();
    });

    it("still answers a non-administrator with the plain refusal", async () => {
      signedInAs("ngo", { aal: "aal1", factors: [] });
      const response = await POST(review({ decision: "approve" }), { params });
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBeUndefined();
    });
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

  it("passes the reviewer's social category to the approval", async () => {
    signedInAs("superadmin");
    rpc.mockResolvedValue({ data: { id: CLAIM_ID, status: "approved" }, error: null });
    const response = await POST(
      review({
        decision: "approve",
        note: "Provjereno: telefonom s predsjednicom.",
        category: "disability_support",
      }),
      { params }
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("approve_institution_claim_transaction", {
      p_reviewer_id: REVIEWER_ID,
      p_claim_id: CLAIM_ID,
      p_note: "Provjereno: telefonom s predsjednicom.",
      p_category: "disability_support",
    });
  });

  it("refuses the catch-all, an unknown category, or a category on a rejection", async () => {
    signedInAs("superadmin");
    for (const body of [
      { decision: "approve", category: "association" },
      { decision: "approve", category: "sports" },
      { decision: "approve", category: 7 },
      { decision: "reject", note: "Nije socijalna udruga.", category: "elderly_care" },
    ]) {
      expect((await POST(review(body), { params })).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("names an approval refused for want of a social category", async () => {
    signedInAs("superadmin");
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "choose a social category for this organisation" },
    });
    const response = await POST(review({ decision: "approve" }), { params });
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("category_required");
    expect(payload.error).not.toContain("category");
  });
});
