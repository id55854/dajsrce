import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, rpc, role, requireSecondFactor } = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  role: { value: "superadmin" as string | null },
  requireSecondFactor: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: role.value ? { role: role.value } : null }) }),
      }),
    }),
  },
}));
vi.mock("@/lib/auth/mfa-server", () => ({ requireSecondFactor }));
vi.mock("@/lib/observability", () => ({
  getRequestId: () => "request-id",
  logError: vi.fn(),
}));
import { POST } from "./route";

const REVIEWER = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

function review(body: unknown, id = REQUEST_ID) {
  return POST(
    new NextRequest(`http://localhost/api/institution-category-requests/${id}/review`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) }
  );
}

describe("POST /api/institution-category-requests/[id]/review", () => {
  beforeEach(() => {
    getUser.mockReset();
    rpc.mockReset();
    requireSecondFactor.mockReset();
    requireSecondFactor.mockResolvedValue(null);
    role.value = "superadmin";
    getUser.mockResolvedValue({ data: { user: { id: REVIEWER } } });
  });

  it("refuses a bad id, a signed-out caller and a non-administrator", async () => {
    expect((await review({ decision: "approve" }, "nope")).status).toBe(400);
    getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await review({ decision: "approve" })).status).toBe(401);
    role.value = "ngo";
    expect((await review({ decision: "approve" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires the administrator's second factor", async () => {
    requireSecondFactor.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await review({ decision: "approve" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a violence-support category before the transaction", async () => {
    expect((await review({ decision: "approve", category: "domestic_violence" })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records the decision with the reviewer taken from the session", async () => {
    rpc.mockResolvedValue({ data: { id: REQUEST_ID, status: "approved" }, error: null });
    const res = await review({ decision: "approve", category: "elderly_care", note: " ok " });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("review_institution_category_request", {
      p_reviewer_id: REVIEWER,
      p_request_id: REQUEST_ID,
      p_decision: "approve",
      p_category: "elderly_care",
      p_note: "ok",
    });
  });

  it("answers 409 for a request that is no longer open", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "no longer open" } });
    expect((await review({ decision: "reject", note: "Ne" })).status).toBe(409);
  });
});
