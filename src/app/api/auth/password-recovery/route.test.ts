import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendPasswordRecovery } = vi.hoisted(() => ({
  sendPasswordRecovery: vi.fn(),
}));

vi.mock("@/lib/auth/password-recovery-server", () => ({ sendPasswordRecovery }));

import { POST } from "./route";

function request(
  body: unknown,
  options: { origin?: string; address?: string; raw?: string } = {}
) {
  return new NextRequest("https://dajsrce.test/api/auth/password-recovery", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: options.origin ?? "https://dajsrce.test",
      "x-forwarded-for": options.address ?? `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: options.raw ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendPasswordRecovery.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/auth/password-recovery", () => {
  it("rejects cross-origin requests before sending email", async () => {
    const response = await POST(request({ email: "person@example.test" }, {
      origin: "https://evil.test",
    }));
    expect(response.status).toBe(403);
    expect(sendPasswordRecovery).not.toHaveBeenCalled();
  });

  it.each([null, "", "not-an-email", `${"a".repeat(250)}@x.test`])(
    "rejects malformed email %s",
    async (email) => {
      const response = await POST(request({ email }));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(sendPasswordRecovery).not.toHaveBeenCalled();
    }
  );

  it("normalizes email and returns a generic accepted response", async () => {
    const response = await POST(request({ email: "  Person@Example.Test " }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(sendPasswordRecovery).toHaveBeenCalledWith("person@example.test");
  });

  it("does not reveal whether Supabase accepted the address", async () => {
    sendPasswordRecovery.mockResolvedValue({ error: { code: "user_not_found" } });
    const response = await POST(request({ email: "missing@example.test" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true });
  });

  it("rate limits repeated requests for the same address across IPs", async () => {
    const email = `limited-${crypto.randomUUID()}@example.test`;
    for (let index = 0; index < 3; index += 1) {
      expect((await POST(request({ email }, { address: `198.51.100.${index + 1}` }))).status)
        .toBe(202);
    }
    const blocked = await POST(request({ email }, { address: "198.51.100.99" }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(sendPasswordRecovery).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid JSON", async () => {
    const response = await POST(request(null, { raw: "{" }));
    expect(response.status).toBe(400);
    expect(sendPasswordRecovery).not.toHaveBeenCalled();
  });
});
