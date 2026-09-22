import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, from } = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), in: vi.fn(), limit: vi.fn() };
  return { query, from: vi.fn(() => query) };
});
vi.mock("@/lib/supabase/public", () => ({ createPublicSupabaseClient: () => ({ from }) }));
import { GET } from "./route";

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
