import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase/public", () => ({
  createPublicSupabaseClient: () => ({ rpc }),
}));

import { GET } from "@/app/api/v1/organisations/route";

describe("GET /api/v1/organisations", () => {
  beforeEach(() => rpc.mockReset());

  it("returns exact pagination, facets and a narrow cacheable item projection", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "search_association_registry_v1") {
        return Promise.resolve({
          error: null,
          data: {
            version: 1,
            items: [{
              id: "200307",
              oib: "42128339233",
              name: "UDRUŽENJE PROSVJETNIH RADNIKA",
              short_name: null,
              status: "AKTIVAN",
              address: "Dunavski prilaz 2, Vukovar",
              city: "Vukovar",
              county: "Vukovarsko-srijemska",
              registered_on: "2015-02-23",
              status_changed_on: null,
              registry_number: "16002098",
              legal_form: "UDRUGA",
              email: null,
              website: null,
              last_verified_at: "2026-08-04T17:04:04Z",
            }],
            meta: { total: 71_057, page: 2, page_size: 24, page_count: 2_961 },
          },
        });
      }
      return Promise.resolve({
        error: null,
        data: {
          total: 71_057,
          statuses: [{ value: "AKTIVAN", count: 43_710 }],
          counties: [{ value: "Vukovarsko-srijemska", count: 2_000 }],
          forms: [{ value: "UDRUGA", count: 68_405 }],
          snapshot: { metadata_modified: "2026-08-04T17:04:04Z" },
        },
      });
    });

    const response = await GET(new NextRequest(
      "http://localhost/api/v1/organisations?status=AKTIVAN&page=2"
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(response.headers.get("etag")).toMatch(/^".+"$/);
    expect(payload.meta).toEqual({ total: 71_057, page: 2, pageSize: 24, pageCount: 2_961 });
    expect(payload.facets.total).toBe(71_057);
    expect(payload.items[0].id).toBe("200307");
    expect(payload.items[0]).not.toHaveProperty("goals");
    expect(payload.items[0]).not.toHaveProperty("activity_description");
    expect(rpc).toHaveBeenCalledWith("search_association_registry_v1", expect.objectContaining({
      p_status: "AKTIVAN",
      p_page: 2,
      p_page_size: 24,
    }));
  });

  it("rejects unbounded or malformed requests before database access", async () => {
    const response = await GET(new NextRequest(
      "http://localhost/api/v1/organisations?q=x&pageSize=1000"
    ));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when either public RPC is unavailable", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const response = await GET(new NextRequest("http://localhost/api/v1/organisations"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
