import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, from, server } = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), in: vi.fn(), limit: vi.fn() };
  const server = { getUser: vi.fn(), from: vi.fn(), insert: vi.fn() };
  return { query, from: vi.fn(() => query), server };
});
vi.mock("@/lib/supabase/public", () => ({ createPublicSupabaseClient: () => ({ from }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: server.getUser }, from: server.from }),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: {} }));
const { notifyNearbyUsers } = vi.hoisted(() => ({ notifyNearbyUsers: vi.fn() }));
vi.mock("@/lib/notify-nearby", () => ({ notifyNearbyUsers }));
import { GET, POST } from "./route";

const INSTITUTION = "22222222-2222-4222-8222-222222222222";

function profileQuery(profile: unknown) {
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue({ data: profile, error: null });
  return chain;
}

function insertQuery(result: unknown) {
  const chain = { insert: vi.fn(), select: vi.fn(), single: vi.fn() };
  chain.insert.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.single.mockResolvedValue(result);
  return chain;
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/needs", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );
}

describe("POST /api/needs", () => {
  let needs: ReturnType<typeof insertQuery>;

  beforeEach(() => {
    vi.clearAllMocks();
    server.getUser.mockResolvedValue({ data: { user: { id: "ngo-user" } } });
    needs = insertQuery({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Zimske jakne",
        institution: { name: "UDRUGA ZA POMOĆ \"SRCE\" ZAGREB", lat: 45.81, lng: 15.97 },
      },
      error: null,
    });
    server.from.mockImplementation((table: string) =>
      table === "profiles" ? profileQuery({ role: "ngo", institution_id: INSTITUTION }) : needs
    );
    notifyNearbyUsers.mockResolvedValue("job");
  });

  it("refuses a new money need in Croatian, before inserting anything", async () => {
    const res = await post({ title: "Novac za ogrjev", donation_type: "money", quantity_needed: 1 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("donation_type_unavailable");
    expect(body.field).toBe("donation_type");
    expect(body.error).toMatch(/^Novčane donacije/);
    expect(needs.insert).not.toHaveBeenCalled();
  });

  it("names the invalid field so the form can say what is wrong", async () => {
    const res = await post({ title: "", donation_type: "food" });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("title");
  });

  it("tells nearby opted-in donors in Croatian, without shouting the legal name", async () => {
    const res = await post({ title: "Zimske jakne", donation_type: "clothes", urgency: "urgent", quantity_needed: 10 });
    expect(res.status).toBe(200);
    expect(notifyNearbyUsers).toHaveBeenCalledTimes(1);
    const [, lat, lng, title, body, link, excluded, key] = notifyNearbyUsers.mock.calls[0];
    expect([lat, lng]).toEqual([45.81, 15.97]);
    expect(title).toBe("Hitna potreba: Zimske jakne");
    expect(body).toBe("Udruga za pomoć \"Srce\" zagreb u vašoj blizini treba: Zimske jakne");
    expect(link).toBe("/doniraj?need=33333333-3333-4333-8333-333333333333");
    expect(excluded).toBe("ngo-user");
    expect(key).toBe("need:33333333-3333-4333-8333-333333333333");
  });
});

describe("needs category filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.limit.mockResolvedValue({ data: [], error: null });
  });
  it("combines organisation categories with donation and urgency before limiting rows", async () => {
    const response = await GET(new NextRequest("http://localhost/api/needs?categories=association,soup_kitchen,association&donation_type=food&urgency=urgent"));
    expect(response.status).toBe(200);
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("institutions!inner("));
    expect(query.in).toHaveBeenCalledWith("institution.category", ["association", "soup_kitchen"]);
    expect(query.eq).toHaveBeenCalledWith("donation_type", "food");
    expect(query.eq).toHaveBeenCalledWith("urgency", "urgent");
    expect(query.in.mock.invocationCallOrder[0]).toBeLessThan(query.limit.mock.invocationCallOrder[0]);
  });
  it("keeps the unfiltered list inclusive and publicly cacheable", async () => {
    const response = await GET(new NextRequest("http://localhost/api/needs"));
    expect(response.status).toBe(200);
    expect(query.select).toHaveBeenCalledWith(expect.not.stringContaining("!inner"));
    expect(query.in).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("public");
  });
  it.each(["unknown", "constructor", "association,unknown"])("rejects invalid category %s before querying", async (category) => {
    const response = await GET(new NextRequest(`http://localhost/api/needs?categories=${category}`));
    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
});
