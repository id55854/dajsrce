import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, single } = vi.hoisted(() => {
  const single = vi.fn();
  return {
    rpc: vi.fn((..._args: unknown[]) => ({ single })),
    single,
  };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));

import { POST } from "@/app/api/institution-claims/confirm/route";

const RAW_TOKEN = "a1b2c3d4".repeat(8); // 32 bytes of hex

function confirm(body: unknown) {
  return new NextRequest("http://localhost/api/institution-claims/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  rpc.mockClear();
  single.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/institution-claims/confirm", () => {
  it("rejects a malformed token before any database access", async () => {
    for (const token of ["", "not-a-token", "abc", `${RAW_TOKEN}f`, null]) {
      const response = await POST(confirm({ token }));
      expect(response.status, String(token)).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends only the SHA-256 digest to the database, never the raw token", async () => {
    single.mockResolvedValue({
      data: {
        claim_id: "claim-1",
        claim_status: "email_sent",
        udr_id: "200307",
        organisation_name: "Udruga",
        confirmed_at: "2026-08-12T10:00:00Z",
      },
      error: null,
    });

    const response = await POST(confirm({ token: RAW_TOKEN }));
    expect(response.status).toBe(200);

    const expected = createHash("sha256").update(RAW_TOKEN, "utf8").digest("hex");
    expect(rpc).toHaveBeenCalledWith("confirm_institution_claim_email", {
      p_token_hash: expected,
    });
    const args = rpc.mock.calls[0]?.[1] as { p_token_hash: string };
    expect(args.p_token_hash).not.toBe(RAW_TOKEN);
  });

  it("refuses an already-consumed token", async () => {
    single.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "verification already used" },
    });
    const response = await POST(confirm({ token: RAW_TOKEN }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).not.toContain("already used");
  });

  it("refuses an expired token", async () => {
    single.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "verification expired" },
    });
    expect((await POST(confirm({ token: RAW_TOKEN }))).status).toBe(409);
  });

  it("refuses an unknown digest as not found", async () => {
    single.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "verification not found" },
    });
    expect((await POST(confirm({ token: RAW_TOKEN }))).status).toBe(404);
  });

  it("never caches a confirmation response", async () => {
    single.mockResolvedValue({ data: null, error: { code: "P0002" } });
    const response = await POST(confirm({ token: RAW_TOKEN }));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
