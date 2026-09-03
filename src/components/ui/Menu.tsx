"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import clsx from "clsx";
import { usePresence } from "./use-presence";

const ORIGINS = {
  "top-left": "origin-top-left left-0",
  "top-right": "origin-top-right right-0",
  "bottom-left": "origin-bottom-left bottom-full left-0 mb-2",
  "bottom-right": "origin-bottom-right bottom-full right-0 mb-2",
} as const;

export type MenuProps = {
  open: boolean;
  onClose: () => void;
  /**
   * Which corner the panel grows from. A popover should scale out of the
   * control that opened it, so the spatial relationship stays obvious.
   */
  align?: keyof typeof ORIGINS;
  /** Element that should regain focus on dismiss, usually the trigger. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
} & (
  | { role?: "menu" | "listbox" | "region"; "aria-label": string; labelledBy?: never }
  | { role?: "menu" | "listbox" | "region"; labelledBy: string; "aria-label"?: never }
);

/**
 * The animated, dismissible popover surface shared by every dropdown.
 *
 * Deliberately does NOT impose keyboard semantics: a listbox, a menu and a
 * notification region each need different roving-focus behaviour, so that stays
 * with the caller. What this guarantees is the part every hand-rolled dropdown
 * in this codebase was missing, symmetric enter/exit motion anchored at the
 * trigger, Escape to dismiss, click-outside, and focus return.
 */
export function Menu({
  open,
  onClose,
  align = "top-right",
  returnFocusRef,
  className,
  children,
  role = "menu",
  ...labels
}: MenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { present, state, onAnimationEnd } = usePresence(open);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (returnFocusRef?.current?.contains(target)) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
      returnFocusRef?.current?.focus();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open, returnFocusRef]);

  if (!present) return null;

  return (
    <div
      ref={panelRef}
      role={role}
      aria-label={labels["aria-label"]}
      aria-labelledby={labels.labelledBy}
      data-ui-motion
      data-state={state}
      onAnimationEnd={onAnimationEnd}
      className={clsx(
        "absolute z-[var(--z-dropdown)] mt-2 overflow-hidden rounded-card border border-border-subtle bg-surface-overlay shadow-overlay",
        "data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out",
        ORIGINS[align],
        className
      )}
    >
      {children}
    </div>
  );
}
