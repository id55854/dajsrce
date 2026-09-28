// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/i18n/client";
import { ToastProvider } from "@/components/ui";
import { EmailNotificationSettings } from "./EmailNotificationSettings";

let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

async function render(initialEnabled: boolean) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initialLocale: "hr" } as ComponentProps<typeof LocaleProvider>,
        createElement(
          ToastProvider,
          null,
          createElement(EmailNotificationSettings, { initialEnabled, email: "ana@example.com" })
        )
      )
    );
  });
}

function toggle(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[role="switch"]')!;
}

async function flip() {
  await act(async () => {
    toggle().click();
  });
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("EmailNotificationSettings", () => {
  it("names the address and saves a change", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ enabled: false }), { status: 200 }));
    await render(true);
    expect(document.body.textContent).toContain("ana@example.com");
    expect(toggle().checked).toBe(true);

    await flip();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/me/email-notifications");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ enabled: false });
    expect(toggle().checked).toBe(false);
    expect(document.body.textContent).toContain("Obavijesti e-poštom su isključene");
  });

  it("puts the switch back when the server refuses", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    await render(false);
    await flip();
    expect(toggle().checked).toBe(false);
    expect(document.body.textContent).toContain("Postavka nije spremljena.");
  });
});
