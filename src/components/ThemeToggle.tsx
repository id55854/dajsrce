"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import clsx from "clsx";
import { useT } from "@/i18n/client";

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const t = useT();

  useEffect(() => {
    // The pre-paint script in the root layout has already resolved and applied
    // the theme; mirror it into state rather than recomputing it here, which
    // would let the icon disagree with the page for a frame.
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function apply(next: boolean) {
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Private-mode storage failures must not block the theme change.
    }
    setDark(next);
  }

  function toggle() {
    const next = !dark;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const doc = document as DocumentWithViewTransition;

    // A theme flip repaints thousands of colour utilities in one frame. Only a
    // fraction of them carry a transition, so without one coordinated crossfade
    // the animated and non-animated surfaces visibly tear apart.
    if (!reduceMotion && typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => apply(next));
      return;
    }
    apply(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={clsx(
        "relative inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-secondary",
        "transition-colors duration-150 hover:bg-surface-sunken hover:text-ink",
        "motion-safe:active:scale-[0.92] motion-safe:transition-transform",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      )}
      aria-label={dark ? t("theme.switch_to_light") : t("theme.switch_to_dark")}
    >
      {/* Both glyphs stay mounted and crossfade, so the change reads as one
          object turning over rather than two nodes swapping. */}
      <Sun
        className={clsx(
          "absolute h-5 w-5 transition-[opacity,transform] duration-250 ease-out",
          dark ? "rotate-0 opacity-100" : "-rotate-90 opacity-0"
        )}
        aria-hidden="true"
      />
      <Moon
        className={clsx(
          "absolute h-5 w-5 transition-[opacity,transform] duration-250 ease-out",
          dark ? "rotate-90 opacity-0" : "rotate-0 opacity-100"
        )}
        aria-hidden="true"
      />
    </button>
  );
}
