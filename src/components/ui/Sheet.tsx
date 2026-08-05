"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  VelocityTracker,
  animateSpring,
  projectMomentum,
  rubberband,
  type SpringHandle,
} from "./spring";

export type SheetProps = {
  /**
   * Resting positions as a fraction of the container's height, ascending.
   * e.g. [0.14, 0.55, 0.95] → a peeking header, roughly half, nearly full.
   */
  detents: number[];
  /** Index into `detents`. Controlled, so the parent can drive it too. */
  detentIndex: number;
  onDetentChange: (index: number) => void;
  /** Always-visible grab area. The whole header is draggable, not just the pill. */
  header?: ReactNode;
  ariaLabel: string;
  /** Accessible name for the drag handle. */
  handleLabel: string;
  className?: string;
  children: ReactNode;
};

/**
 * A draggable bottom sheet with detents — the pattern that lets a map stay
 * visible while a list, a filter row and a detail view all remain reachable,
 * instead of swapping between mutually exclusive full-screen views.
 *
 * The gesture follows the finger 1:1 (respecting where it was grabbed), resists
 * progressively past the top detent, projects momentum on release to pick the
 * detent a flick was aimed at, and hands the release velocity to a spring so
 * there is no seam between dragging and animating. Grabbing it mid-flight
 * cancels the spring and re-targets from the live position.
 *
 * Must be rendered inside a `relative` container.
 */
export function Sheet({
  detents,
  detentIndex,
  onDetentChange,
  header,
  ariaLabel,
  handleLabel,
  className,
  children,
}: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const springRef = useRef<SpringHandle | null>(null);
  const tracker = useRef(new VelocityTracker());
  const dragRef = useRef<{
    pointerId: number;
    grabOffset: number;
    startTranslate: number;
    startedOnHandle: boolean;
    moved: boolean;
  } | null>(null);
  // The live translate value. Kept in a ref (not state) so a drag writes to the
  // DOM once per frame instead of re-rendering the whole subtree.
  const translateRef = useRef(0);
  const suppressHandleClickRef = useRef(false);
  // Until the container has been measured we cannot know where the detents are.
  // The first placement must therefore be a jump, not a spring, or the sheet
  // visibly animates up from nothing on mount.
  const settledOnceRef = useRef(false);

  const sorted = detents;
  const clampIndex = useCallback(
    (i: number) => Math.min(Math.max(i, 0), sorted.length - 1),
    [sorted.length]
  );

  const translateForIndex = useCallback(
    (index: number) => height * (1 - (sorted[clampIndex(index)] ?? 0.5)),
    [clampIndex, height, sorted]
  );

  const applyTranslate = useCallback((value: number) => {
    translateRef.current = value;
    const node = sheetRef.current;
    if (node) node.style.transform = `translate3d(0, ${value}px, 0)`;
  }, []);

  // Measure the container so detents are relative to available space.
  useLayoutEffect(() => {
    const parent = sheetRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.height ?? 0;
      if (next > 0) setHeight(next);
    });
    observer.observe(parent);
    setHeight(parent.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, []);

  const prefersReducedMotion = useCallback(() => {
    if (typeof window === "undefined") return false;
    // The spring runs on requestAnimationFrame, so neither the reduced-motion
    // media query nor the accessibility menu's `.stop-animations` rule (both
    // CSS-only) can stop it — check them here instead. Dragging itself stays
    // 1:1 regardless: that is direct manipulation, not decoration.
    return (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.classList.contains("stop-animations")
    );
  }, []);

  const settleTo = useCallback(
    (index: number, velocity: number) => {
      const target = translateForIndex(index);
      springRef.current?.cancel();

      if (prefersReducedMotion() || !settledOnceRef.current) {
        settledOnceRef.current = true;
        applyTranslate(target);
        return;
      }

      springRef.current = animateSpring({
        from: translateRef.current,
        to: target,
        velocity,
        // Slightly under-damped: this surface is usually thrown, and a little
        // give at the end reads as weight rather than as a mechanism.
        damping: 26,
        onFrame: applyTranslate,
      });
    },
    [applyTranslate, prefersReducedMotion, translateForIndex]
  );

  // Follow the controlled index (and re-settle when the container resizes).
  useEffect(() => {
    if (height <= 0 || dragRef.current) return;
    settleTo(detentIndex, 0);
  }, [detentIndex, height, settleTo]);

  useEffect(() => () => springRef.current?.cancel(), []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    // Grabbing mid-animation must take over from the current on-screen value,
    // never from the target, or the sheet visibly jumps.
    springRef.current?.cancel();
    event.currentTarget.setPointerCapture(event.pointerId);

    dragRef.current = {
      pointerId: event.pointerId,
      grabOffset: event.clientY,
      startTranslate: translateRef.current,
      // Pointer capture retargets the compatibility click to this wrapper, so
      // the handle button's own onClick never fires on touch. Remember whether
      // the press began on the handle and synthesise the tap ourselves.
      startedOnHandle: Boolean(
        (event.target as Element | null)?.closest?.("[data-sheet-handle]")
      ),
      moved: false,
    };
    tracker.current.reset();
    tracker.current.add(event.clientY, event.timeStamp);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    tracker.current.add(event.clientY, event.timeStamp);

    const delta = event.clientY - drag.grabOffset;
    // A few pixels of hysteresis before a press is treated as a drag, so a
    // slightly imprecise tap still reads as a tap.
    if (Math.abs(delta) > 6) drag.moved = true;
    let next = drag.startTranslate + delta;

    const min = translateForIndex(sorted.length - 1);
    const max = translateForIndex(0);
    if (next < min) {
      next = min - rubberband(min - next, height);
    } else if (next > max) {
      next = max + rubberband(next - max, height);
    }

    applyTranslate(next);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;

    // A tap on the handle cycles detents rather than settling back. Whether the
    // browser also delivers a click here depends on pointer-capture
    // retargeting, so suppress the next one instead of risking a double toggle.
    if (!drag.moved && drag.startedOnHandle) {
      suppressHandleClickRef.current = true;
      onDetentChange(
        detentIndex >= sorted.length - 1 ? 0 : clampIndex(detentIndex + 1)
      );
      return;
    }

    const velocity = tracker.current.velocity();
    // Decide the destination from where the gesture was *going*, not from where
    // the finger happened to lift. This is what makes a flick feel thrown.
    const projected = translateRef.current + projectMomentum(velocity);

    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < sorted.length; i += 1) {
      const distance = Math.abs(translateForIndex(i) - projected);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    if (bestIndex === detentIndex) {
      settleTo(bestIndex, velocity);
    } else {
      // Let the parent's state drive the settle so the two stay in sync.
      onDetentChange(bestIndex);
      settleTo(bestIndex, velocity);
    }
  }

  const atFullDetent = detentIndex === sorted.length - 1;

  return (
    <div
      ref={sheetRef}
      role="region"
      aria-label={ariaLabel}
      data-ui-material
      className={clsx(
        "absolute inset-x-0 bottom-0 z-[var(--z-sheet)] flex flex-col",
        "rounded-t-sheet border-t border-border-subtle bg-chrome shadow-overlay backdrop-blur-xl",
        // Height is the full container; the transform decides how much shows.
        "h-full",
        className
      )}
      // Parked off-screen for the single frame before the container is measured.
      style={{
        transform: height > 0 ? `translate3d(0, ${translateRef.current}px, 0)` : "translate3d(0, 100%, 0)",
      }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // Claim vertical gestures so the browser does not also scroll the page.
        className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
      >
        <div className="flex justify-center py-2">
          <button
            type="button"
            data-sheet-handle
            aria-label={handleLabel}
            aria-expanded={atFullDetent}
            // Kept for keyboard and assistive tech; touch taps are synthesised
            // in endDrag because pointer capture eats the click.
            onClick={() => {
              if (suppressHandleClickRef.current) {
                suppressHandleClickRef.current = false;
                return;
              }
              onDetentChange(atFullDetent ? 0 : clampIndex(detentIndex + 1));
            }}
            // Generous hit area around a deliberately small visual grabber.
            className="group -my-2 flex h-9 w-16 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-10 rounded-full bg-border-strong transition-colors group-hover:bg-ink-tertiary"
            />
          </button>
        </div>
        {header ? <div className="px-3 pb-2">{header}</div> : null}
      </div>

      <div
        ref={scrollRef}
        // Only the fully-open sheet scrolls its content; below that the gesture
        // belongs to the sheet, so an inner scroller would swallow it.
        className={clsx(
          "min-h-0 flex-1 overscroll-contain px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
          atFullDetent ? "overflow-y-auto" : "overflow-hidden"
        )}
      >
        {children}
      </div>
    </div>
  );
}
