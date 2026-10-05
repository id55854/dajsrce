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

/** Movement (px) before a press counts as a drag, so a shaky tap stays a tap. */
const DRAG_SLOP = 6;

/**
 * Where a press must never become a sheet drag: text entry keeps its caret and
 * selection gestures, and the search suggestions are their own scroller.
 */
const NO_SHEET_DRAG =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="listbox"], [data-no-sheet-drag]';

export type SheetGestureDecision = "pending" | "sheet" | "native";

/**
 * Who owns a touch that began on the sheet's content rather than its handle,
 * decided once, at the first movement past the slop:
 *
 * - sideways movement stays native (a chip row keeps its horizontal scroll);
 * - below the top detent every vertical movement moves the sheet, so a swipe up
 *   over the list or a detail expands it instead of scrolling a sliver;
 * - at the top detent the content scrolls, except a pull down from its very
 *   top, which collapses the sheet as in the platform maps apps.
 */
export function decideSheetGesture({
  dx,
  dy,
  atFullDetent,
  contentAtTop,
  slop = DRAG_SLOP,
}: {
  dx: number;
  dy: number;
  atFullDetent: boolean;
  contentAtTop: boolean;
  slop?: number;
}): SheetGestureDecision {
  if (Math.abs(dx) <= slop && Math.abs(dy) <= slop) return "pending";
  if (Math.abs(dy) <= Math.abs(dx)) return "native";
  if (!atFullDetent) return "sheet";
  return dy > 0 && contentAtTop ? "sheet" : "native";
}

export type SheetProps = {
  /**
   * Resting positions as a fraction of the container's height, ascending.
   * e.g. [0.14, 0.55, 0.95] → a peeking header, roughly half, nearly full.
   */
  detents: number[];
  /** Index into `detents`. Controlled, so the parent can drive it too. */
  detentIndex: number;
  onDetentChange: (index: number) => void;
  /** Always-visible controls below the draggable handle. */
  header?: ReactNode;
  ariaLabel: string;
  /** Accessible name for the drag handle. */
  handleLabel: string;
  className?: string;
  children: ReactNode;
};

/**
 * A draggable bottom sheet with detents; the pattern that lets a map stay
 * visible while a list, a filter row and a detail view all remain reachable,
 * instead of swapping between mutually exclusive full-screen views.
 *
 * The gesture follows the finger 1:1 (respecting where it was grabbed), resists
 * progressively past the top detent, projects momentum on release to pick the
 * detent a flick was aimed at, and hands the release velocity to a spring so
 * there is no seam between dragging and animating. Grabbing it mid-flight
 * cancels the spring and re-targets from the live position.
 *
 * The handle drags with any pointer (and a tap on it cycles detents); a touch
 * anywhere else on the sheet drags it too once it is clearly vertical, which
 * below the top detent is every vertical swipe and at the top detent only a
 * pull down from the top of the content.
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
  const handleStripRef = useRef<HTMLDivElement>(null);
  // A touch that began on the header or the content (see decideSheetGesture).
  const touchDragRef = useRef<{
    id: number;
    target: Element;
    startX: number;
    startY: number;
    state: SheetGestureDecision;
    grabOffset: number;
    startTranslate: number;
  } | null>(null);
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
    if (node) {
      node.style.transform = `translate3d(0, ${value}px, 0)`;
      node.style.setProperty("--sheet-offset", `${value}px`);
    }
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
    // CSS-only) can stop it, check them here instead. Dragging itself stays
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
    if (height <= 0 || dragRef.current || touchDragRef.current?.state === "sheet") return;
    settleTo(detentIndex, 0);
  }, [detentIndex, height, settleTo]);

  useEffect(() => () => springRef.current?.cancel(), []);

  function followFinger(startTranslate: number, delta: number) {
    let next = startTranslate + delta;

    const min = translateForIndex(sorted.length - 1);
    const max = translateForIndex(0);
    if (next < min) {
      next = min - rubberband(min - next, height);
    } else if (next > max) {
      next = max + rubberband(next - max, height);
    }

    applyTranslate(next);
  }

  function release(velocity: number) {
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

    // Let the parent's state drive the settle so the two stay in sync.
    if (bestIndex !== detentIndex) onDetentChange(bestIndex);
    settleTo(bestIndex, velocity);
  }

  const atFullDetent = detentIndex === sorted.length - 1;

  // The touch listeners below are bound once; they read this render's values.
  const latestRef = useRef({ atFullDetent, followFinger, release });
  useLayoutEffect(() => {
    latestRef.current = { atFullDetent, followFinger, release };
  });

  // Drag from anywhere: the header and the content move the sheet too, not just
  // the handle. Touch events rather than pointer events, because a pointer
  // stream ends in pointercancel the moment the browser starts a native pan,
  // and only a non-passive touchmove can refuse that pan (React's are
  // passive). A touch stays bound to the element it began on, so no capture is
  // needed, and nothing is claimed until the movement is clearly vertical, so
  // taps, text selection and horizontal scrollers inside keep working.
  useEffect(() => {
    const root = sheetRef.current;
    if (!root) return;
    let suppressClickUntil = 0;

    function findTouch(list: TouchList, id: number) {
      for (let i = 0; i < list.length; i += 1) {
        if (list[i]!.identifier === id) return list[i]!;
      }
      return null;
    }

    // A pull down only belongs to the sheet when nothing under the finger
    // (the sheet's scroller or a scroller nested in it) is scrolled.
    function contentAtTop(target: Element) {
      for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
        if (node.scrollTop > 0) return false;
      }
      return true;
    }

    function onTouchStart(event: TouchEvent) {
      // A tap after a drag is a new gesture; only the drag's own click is eaten.
      suppressClickUntil = 0;
      const active = touchDragRef.current;
      if (active) {
        // A second finger before the first was decided is a pinch, not a drag.
        if (active.state === "pending") active.state = "native";
        return;
      }
      const touch = event.changedTouches[0];
      const target = event.target;
      if (dragRef.current || event.touches.length > 1 || !touch) return;
      if (!(target instanceof Element)) return;
      // The handle strip runs its own pointer gesture (with tap-to-cycle).
      if (handleStripRef.current?.contains(target) || target.closest(NO_SHEET_DRAG)) return;

      touchDragRef.current = {
        id: touch.identifier,
        target,
        startX: touch.clientX,
        startY: touch.clientY,
        state: "pending",
        grabOffset: touch.clientY,
        startTranslate: translateRef.current,
      };
      tracker.current.reset();
      tracker.current.add(touch.clientY, event.timeStamp);
    }

    function onTouchMove(event: TouchEvent) {
      const drag = touchDragRef.current;
      if (!drag || drag.state === "native") return;
      const touch = findTouch(event.changedTouches, drag.id);
      if (!touch) return;
      tracker.current.add(touch.clientY, event.timeStamp);

      if (drag.state === "pending") {
        const { atFullDetent: atFull } = latestRef.current;
        drag.state = decideSheetGesture({
          dx: touch.clientX - drag.startX,
          dy: touch.clientY - drag.startY,
          atFullDetent: atFull,
          contentAtTop: atFull ? contentAtTop(drag.target) : true,
        });
        if (drag.state !== "sheet") return;
        // Take over from the live position, as a grab on the handle does. The
        // slop is not replayed, so the sheet starts from rest under the finger.
        springRef.current?.cancel();
        drag.grabOffset = touch.clientY;
        drag.startTranslate = translateRef.current;
      }

      // No native scroll, overscroll or pull-to-refresh while the sheet moves.
      if (event.cancelable) event.preventDefault();
      latestRef.current.followFinger(drag.startTranslate, touch.clientY - drag.grabOffset);
    }

    function onTouchEnd(event: TouchEvent) {
      const drag = touchDragRef.current;
      if (!drag || !findTouch(event.changedTouches, drag.id)) return;
      touchDragRef.current = null;
      if (drag.state !== "sheet") return;

      // Lifting over a button or a row must not activate it. Cancelling the
      // touchend stops the compatibility click; the capture listener below is
      // the backstop for browsers that synthesise one anyway.
      if (event.cancelable) event.preventDefault();
      suppressClickUntil = performance.now() + 600;
      latestRef.current.release(event.type === "touchcancel" ? 0 : tracker.current.velocity());
    }

    function onClickCapture(event: MouseEvent) {
      if (performance.now() > suppressClickUntil) return;
      suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    }

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd, { passive: false });
    root.addEventListener("touchcancel", onTouchEnd, { passive: false });
    root.addEventListener("click", onClickCapture, true);
    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
      root.removeEventListener("click", onClickCapture, true);
      touchDragRef.current = null;
    };
  }, []);

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
    if (Math.abs(delta) > DRAG_SLOP) drag.moved = true;
    followFinger(drag.startTranslate, delta);
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

    release(tracker.current.velocity());
  }

  return (
    <div
      ref={sheetRef}
      role="region"
      aria-label={ariaLabel}
      data-ui-material
      className={clsx(
        "absolute inset-x-0 top-0 z-[var(--z-sheet)] flex flex-col",
        "rounded-t-sheet border-t border-border-subtle bg-chrome shadow-overlay backdrop-blur-xl",
        className
      )}
      // Parked off-screen for the single frame before the container is measured.
      style={{
        transform: height > 0 ? `translate3d(0, ${translateRef.current}px, 0)` : "translate3d(0, 100%, 0)",
        // The scroller ends at the visible bottom at EVERY detent. A full-
        // height translated sheet left its last rows below the viewport.
        height: "calc(100% - max(0px, var(--sheet-offset, 100%)))",
      }}
    >
      <div
        ref={handleStripRef}
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
      </div>
      {/* Controls and search suggestions must not inherit touch-action:none. */}
      {header ? <div className="shrink-0 px-3 pb-2">{header}</div> : null}

      <div
        ref={scrollRef}
        className={clsx(
          "min-h-0 flex-1 overscroll-contain px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
          // Below the top detent the content does not scroll at all, so a swipe
          // over it can only move the sheet. Programmatic scrolling (focus,
          // scrollIntoView) still works, and the offset survives a collapse.
          atFullDetent ? "overflow-y-auto" : "overflow-y-hidden"
        )}
      >
        {children}
      </div>
    </div>
  );
}
