import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}));

import { GET } from "@/app/api/institution-claims/search/route";

const ENTRY = {
  id: "200307",
  name: "Udruga",
  short_name: null,
  status: "AKTIVAN",
  address: null,
  city: "Zagreb",
  county: null,
  registry_number: null,
  legal_form: null,
  registry_email: null,
  claim_state: "available",
};

function search(query: string) {
  return GET(new NextRequest(`http://localhost/api/institution-claims/search?${query}`));
}

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "11111111-2222-4333-8444-555555555555" } } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/institution-claims/search", () => {
  it("asks the RPC for the requested page and passes its truncation flag on", async () => {
    rpc.mockResolvedValue({
      data: { version: 1, items: [ENTRY], limit: 25, truncated: true },
      error: null,
    });
    const response = await search("q=udruga&limit=25");
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("search_claimable_associations_v1", {
      p_query: "udruga",
      p_county: null,
      p_limit: 25,
    });
    const payload = await response.json();
    expect(payload.items).toHaveLength(1);
    expect(payload.truncated).toBe(true);
  });

  it("treats a full page from an older schema as truncated", async () => {
    rpc.mockResolvedValue({
      data: { version: 1, items: [ENTRY, { ...ENTRY, id: "200308" }], limit: 2 },
      error: null,
    });
    expect((await (await search("q=udruga&limit=2")).json()).truncated).toBe(true);
    rpc.mockResolvedValue({ data: { version: 1, items: [ENTRY], limit: 2 }, error: null });
    expect((await (await search("q=udruga&limit=2")).json()).truncated).toBe(false);
  });

  it("reports a missing snapshot as an error, not as an empty result", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "no registry snapshot is published" },
    });
    const response = await search("q=udruga");
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.code).toBe("registry_unavailable");
    expect(payload.items).toBeUndefined();
  });

  it("refuses an anonymous lookup", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await search("q=udruga")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
