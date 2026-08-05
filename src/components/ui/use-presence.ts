"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps a node mounted while its exit animation plays.
 *
 * React unmounts synchronously, so a conditional render can only ever animate
 * in. This defers the unmount until the CSS animation on the returned node
 * finishes, which is what lets a surface leave along the path it arrived on.
 *
 * Usage:
 *   const { present, state, onAnimationEnd } = usePresence(open);
 *   if (!present) return null;
 *   <div data-ui-motion data-state={state} onAnimationEnd={onAnimationEnd} />
 *
 * The `data-state` attribute is the styling hook: `[data-state="closed"]`
 * selects the exit keyframes.
 */
export function usePresence(open: boolean, fallbackMs = 400) {
  const [present, setPresent] = useState(open);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (open) {
      clearTimer();
      setPresent(true);
      return;
    }
    if (!present) return;

    // `animationend` is the primary signal, but it never fires when animations
    // are disabled outright (the accessibility menu's "stop animations" sets
    // animation-duration to 0s). Without this fallback the node would stay
    // mounted forever.
    clearTimer();
    timerRef.current = window.setTimeout(() => setPresent(false), fallbackMs);
    return clearTimer;
  }, [clearTimer, fallbackMs, open, present]);

  useEffect(() => clearTimer, [clearTimer]);

  const onAnimationEnd = useCallback(
    (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
      // Ignore animations bubbling up from children.
      if (event.target !== event.currentTarget) return;
      if (!open) {
        clearTimer();
        setPresent(false);
      }
    },
    [clearTimer, open]
  );

  return {
    present,
    state: open ? ("open" as const) : ("closed" as const),
    onAnimationEnd,
  };
}
