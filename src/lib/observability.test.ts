import { describe, expect, it, vi } from "vitest";
import { getRequestId, logError } from "./observability";

describe("observability helpers", () => {
  it("accepts a safe incoming request id and rejects header injection", () => {
    expect(getRequestId(new Headers({ "x-request-id": "request-1234" }))).toBe("request-1234");
    expect(getRequestId(new Headers({ "x-request-id": "bad value" }))).toMatch(
      /^[0-9a-f-]{36}$/
    );
  });

  it("emits structured errors without stack traces or raw messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logError("test.failed", new Error("safe message"), { request_id: "request-1234" });

    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      level: "error",
      event: "test.failed",
      request_id: "request-1234",
      error_name: "Error",
    });
    expect(payload).not.toHaveProperty("stack");
    expect(payload).not.toHaveProperty("error_message");
    spy.mockRestore();
  });
});
