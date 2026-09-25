// @vitest-environment jsdom

import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogFocus } from "./use-dialog-focus";

function TestDialog({ open, onClose, name = "outer" }: {
  open: boolean;
  onClose: () => void;
  name?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus({ open, dialogRef: ref, onClose });
  return open ? createElement("div", { ref, role: "dialog", tabIndex: -1 },
    createElement("button", { id: `${name}-first` }, "First"),
    createElement("input", { id: `${name}-input` }),
    createElement("button", { id: `${name}-last` }, "Last"),
    createElement("div", { hidden: true }, createElement("button", { id: `${name}-hidden` }, "Hidden option")),
  ) : null;
}

describe("dialog focus lifecycle", () => {
  let root: Root;
  let trigger: HTMLButtonElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    document.body.innerHTML = '<button id="trigger">Filters</button><div id="root"></div>';
    document.body.style.overflow = "auto";
    trigger = document.querySelector<HTMLButtonElement>("#trigger")!;
    trigger.focus();
    root = createRoot(document.querySelector("#root")!);
    // jsdom has no layout. Model visibility, including a closed option panel.
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
      return (this.closest("[hidden]") ? [] : [{}]) as unknown as DOMRectList;
    });
  });

  afterEach(async () => {
    await act(() => root.unmount());
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    document.body.style.overflow = "";
  });

  it("keeps an edited field focused across data refreshes and calls the latest close handler", async () => {
    const oldClose = vi.fn();
    const newClose = vi.fn();
    await act(() => root.render(createElement(TestDialog, { open: true, onClose: oldClose })));
    const input = document.querySelector<HTMLInputElement>("#outer-input")!;
    input.focus();
    await act(() => root.render(createElement(TestDialog, { open: true, onClose: newClose })));
    expect(document.activeElement).toBe(input);
    expect(document.body.style.overflow).toBe("hidden");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(oldClose).not.toHaveBeenCalled();
    expect(newClose).toHaveBeenCalledOnce();
  });

  it("focuses and restores without scrolling the map's clipped containers", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    await act(() => root.render(createElement(TestDialog, { open: true, onClose: vi.fn() })));
    expect(document.activeElement?.id).toBe("outer-first");
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    await act(() => root.render(createElement(TestDialog, { open: false, onClose: vi.fn() })));
    expect(document.activeElement).toBe(trigger);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(document.body.style.overflow).toBe("auto");
  });

  it("wraps Tab around visible controls, skipping closed dropdown options", async () => {
    await act(() => root.render(createElement(TestDialog, { open: true, onClose: vi.fn() })));
    const first = document.querySelector<HTMLButtonElement>("#outer-first")!;
    const last = document.querySelector<HTMLButtonElement>("#outer-last")!;
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
  });

  it("keeps nested dialogs locked until the last one closes, even if the outer closes first", async () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    const render = (outer: boolean, inner: boolean) => act(() => root.render(createElement("div", null,
      createElement(TestDialog, { open: outer, onClose: outerClose }),
      createElement(TestDialog, { open: inner, onClose: innerClose, name: "inner" }),
    )));
    await render(true, false);
    await render(true, true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(innerClose).toHaveBeenCalledOnce();
    expect(outerClose).not.toHaveBeenCalled();
    await render(false, true);
    expect(document.body.style.overflow).toBe("hidden");
    await render(false, false);
    expect(document.body.style.overflow).toBe("auto");
  });
});
