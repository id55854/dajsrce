// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterDropdown } from "./FilterDropdown";

function Picker({ multiple }: { multiple: boolean }) {
  const [value, setValue] = useState<string[]>([]);
  return createElement("div", { role: "dialog", tabIndex: -1 },
    createElement(FilterDropdown<string>, {
      label: "Filter", allLabel: "All", searchable: true, multiple,
      options: [{ value: "first", label: "First option" }, { value: "second", label: "Second option" }],
      value, onChange: setValue,
    }),
    createElement("output", null, value.join(",")),
  );
}

describe("searchable filter option activation", () => {
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    document.body.innerHTML = '<div id="root"></div><button id="outside">Outside</button>';
    root = createRoot(document.querySelector("#root")!);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  async function openPicker(multiple: boolean) {
    await act(() => root.render(createElement(Picker, { multiple })));
    const panel = document.querySelector<HTMLElement>("[popover]")!;
    // jsdom does not implement top-layer popover behavior. Model only its
    // toggle lifecycle; browser QA covers actual label hit-testing/light-dismiss.
    function toggle(newState: "open" | "closed") {
      panel.hidden = newState === "closed";
      panel.dispatchEvent(Object.assign(new Event("toggle"), { newState }));
    }
    panel.showPopover = vi.fn(() => toggle("open"));
    panel.hidePopover = vi.fn(() => toggle("closed"));
    const trigger = document.querySelector<HTMLButtonElement>("[aria-controls]")!;
    await act(() => trigger.click());
    const search = panel.querySelector<HTMLInputElement>('input:not([type])')!;
    expect(document.activeElement).toBe(search);
    return { panel, trigger, search };
  }

  async function pressOptionText(panel: HTMLElement, label: string) {
    const text = Array.from(panel.querySelectorAll("span.block"))
      .find((element) => element.textContent === label)!;
    // On label text/padding, pointer-down may focus the tabindex=-1 dialog
    // before the label forwards the eventual click to its native input.
    await act(() => {
      text.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.querySelector<HTMLElement>('[role="dialog"]')!.focus();
    });
    expect(panel.hidePopover).not.toHaveBeenCalled();
    await act(() => text.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  }

  it("selects organisation rows by their text without dismissing the multi-select", async () => {
    const { panel, search } = await openPicker(true);
    await pressOptionText(panel, "First option");
    expect(document.querySelector("output")?.textContent).toBe("first");
    expect(panel.hidden).toBe(false);
    search.focus();
    await pressOptionText(panel, "Second option");
    expect(document.querySelector("output")?.textContent).toBe("first,second");
    expect(panel.hidePopover).not.toHaveBeenCalled();
  });

  it("commits a city row before closing the single-select and restoring focus", async () => {
    const { panel, trigger } = await openPicker(false);
    await pressOptionText(panel, "Second option");
    expect(document.querySelector("output")?.textContent).toBe("second");
    expect(panel.hidePopover).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("still dismisses when keyboard Tab moves focus outside", async () => {
    const { panel, search } = await openPicker(true);
    let nextFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      nextFrame = callback;
      return 1;
    });
    await act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      document.querySelector<HTMLButtonElement>("#outside")!.focus();
      nextFrame?.(0);
    });
    expect(panel.hidePopover).toHaveBeenCalledOnce();
    expect(panel.hidden).toBe(true);
  });
});
