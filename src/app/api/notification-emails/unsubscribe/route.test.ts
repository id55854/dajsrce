import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { rpc } }));

import { GET, POST } from "./route";

const TOKEN = "c".repeat(64);
const DIGEST = createHash("sha256").update(TOKEN).digest("hex");

function request(method: "GET" | "POST", query: string, body?: string) {
  return new NextRequest(`https://dajsrce.hr/api/notification-emails/unsubscribe${query}`, {
    method,
    headers: {
      "x-forwarded-for": `10.2.0.${Math.floor(Math.random() * 250)}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      // A mail client posts from outside the site.
      "sec-fetch-site": "cross-site",
    },
    ...(body ? { body } : {}),
  });
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("notification e-mail unsubscribe", () => {
  it("never unsubscribes on GET, it only opens the confirmation page", async () => {
    const response = await GET(request("GET", `?t=${TOKEN}`));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://dajsrce.hr/obavijesti/odjava?t=${TOKEN}`);
    expect(rpc).not.toHaveBeenCalled();
    expect((await GET(request("GET", "?t=<script>"))).headers.get("location")).toBe(
      "https://dajsrce.hr/obavijesti/odjava"
    );
  });

  it("accepts an RFC 8058 one-click POST from a mail client with the token digest", async () => {
    const response = await POST(request("POST", `?t=${TOKEN}`, "List-Unsubscribe=One-Click"));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("unsubscribe_notification_emails", { p_token_hash: DIGEST });
  });

  it("answers the confirmation form with the result page", async () => {
    const response = await POST(request("POST", "", `t=${TOKEN}`));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://dajsrce.hr/obavijesti/odjava?gotovo=1");
  });

  it("rejects a malformed or unknown token without saying whose it is", async () => {
    const malformed = await POST(request("POST", "?t=abc", "List-Unsubscribe=One-Click"));
    expect(malformed.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: false, error: null });
    expect((await POST(request("POST", `?t=${TOKEN}`, "List-Unsubscribe=One-Click"))).status).toBe(404);
    expect((await POST(request("POST", "", `t=${TOKEN}`))).headers.get("location")).toBe(
      "https://dajsrce.hr/obavijesti/odjava?nevazeca=1"
    );
  });

  it("sends the form back to the page when the database is unavailable", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    expect((await POST(request("POST", "", `t=${TOKEN}`))).headers.get("location")).toBe(
      `https://dajsrce.hr/obavijesti/odjava?t=${TOKEN}&greska=1`
    );
  });
});
