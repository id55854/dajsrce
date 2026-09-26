import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));

import { GET, POST } from "./route";

const SECRET = "s".repeat(40);

function call(method: "GET" | "POST", authorization?: string) {
  const request = new NextRequest("http://localhost/api/cron/process-notification-jobs", {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      "x-forwarded-for": `10.0.1.${Math.floor(Math.random() * 250)}`,
    },
  });
  return method === "GET" ? GET(request) : POST(request);
}

describe("/api/cron/process-notification-jobs", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(["POST", "GET"] as const)("drains the queue on %s with the bearer secret", async (method) => {
    rpc.mockResolvedValue({ data: null, error: null });
    const response = await call(method, `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, processed: 0 });
    expect(rpc).toHaveBeenCalledWith("claim_notification_job");
  });

  it.each(["POST", "GET"] as const)("refuses %s without the right secret", async (method) => {
    expect((await call(method)).status).toBe(401);
    expect((await call(method, "Bearer nope")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed without a strong secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("GET", "Bearer ")).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
});
