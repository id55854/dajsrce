import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/institutions/route";

describe("legacy GET /api/institutions", () => {
  it("fails explicitly without returning an unsafe or truncated catalogue", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("link")).toContain("/api/v1/map/institutions");
    expect(payload.replacement).toBe("/api/v1/map/institutions");
    expect(payload).not.toHaveProperty("institutions");
  });
});
