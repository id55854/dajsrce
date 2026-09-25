"use client";

import type { RefObject } from "react";
import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Open dialogs, innermost last. Dialogs nest (a confirm opened from a details
 * dialog), and both may close in the same commit, in either order. A per-
 * dialog "restore what I saw" left the page locked whenever the outer one
 * restored first and the inner one then put back the "hidden" it had seen,
 * so the scroll lock is shared: taken by the first dialog, released by the
 * last. Only the innermost dialog answers Escape and Tab.
 */
const openDialogs: HTMLElement[] = [];
let overflowBeforeLock = "";

function lockScroll(dialog: HTMLElement) {
  if (openDialogs.length === 0) {
    overflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  openDialogs.push(dialog);
}

function unlockScroll(dialog: HTMLElement) {
  const index = openDialogs.lastIndexOf(dialog);
  if (index !== -1) openDialogs.splice(index, 1);
  if (openDialogs.length === 0) document.body.style.overflow = overflowBeforeLock;
}

export function useDialogFocus({
  open,
  dialogRef,
  onClose,
}: {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  // Callers often pass an inline closure. A data refresh must not tear down the
  // trap, restore the trigger, and steal focus from a field or open dropdown.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    lockScroll(dialog);

    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
    const initial =
      dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
      focusable()[0] ??
      dialog;
    initial.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (openDialogs[openDialogs.length - 1] !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        dialog?.focus({ preventScroll: true });
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      unlockScroll(dialog);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [dialogRef, open]);
}
