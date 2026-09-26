import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every auth surface that collects an email or a password.
const PAGES = ["login", "register", "forgot-password", "reset-password"];

function source(page: string): string {
  return readFileSync(resolve(process.cwd(), "src/app/auth", page, "page.tsx"), "utf8");
}

describe("auth forms", () => {
  it("post to the page itself, so a submit before hydration never puts credentials in a URL", () => {
    // A <form> without a method is a GET: pressing Enter before the page
    // hydrates would send ?email=...&password=... into the address bar,
    // history and access logs.
    for (const page of PAGES) {
      const forms = source(page).match(/<form\b[^>]*/g) ?? [];
      expect(forms.length, page).toBeGreaterThan(0);
      for (const form of forms) {
        expect(form, page).toContain('method="post"');
        expect(form, page).toContain('action="#"');
        expect(form, page).toContain("onSubmit=");
      }
    }
  });

  it("still handles the submit in script", () => {
    for (const page of PAGES) {
      expect(source(page), page).toContain("preventDefault()");
    }
  });
});
