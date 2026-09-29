"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { AUTO_START_PATHS } from "./tour-steps";
import {
  OPEN_TOUR_EVENT,
  clearTourProgress,
  isTourPending,
  readTourProgress,
  type TourProgress,
} from "./tour-storage";

// The tour (its steps, illustrations and geometry) is loaded only when it is
// about to open. Every page carries this launcher, so it has to stay tiny.
const Tour = dynamic(() => import("./Tour").then((module) => module.Tour), { ssr: false });

/** Lets the page paint and settle before a first-visit overlay covers it. */
const AUTO_START_DELAY_MS = 900;

/**
 * Opens the walkthrough on a visitor's first visit to one of the public pages,
 * resumes it after a reload mid-tour, and reopens it whenever something fires
 * `OPEN_TOUR_EVENT` (the footer and menu links).
 */
export function TourLauncher() {
  const pathname = usePathname();
  const [session, setSession] = useState<{ key: number; initial: TourProgress | null } | null>(null);
  const autoTried = useRef(false);

  useEffect(() => {
    function open() {
      clearTourProgress();
      setSession((prev) => ({ key: (prev?.key ?? 0) + 1, initial: null }));
    }
    window.addEventListener(OPEN_TOUR_EVENT, open);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, open);
  }, []);

  useEffect(() => {
    if (session || autoTried.current) return;
    const resumed = readTourProgress();
    if (resumed) {
      autoTried.current = true;
      setSession({ key: 1, initial: resumed });
      return;
    }
    if (!AUTO_START_PATHS.includes(pathname) || !isTourPending()) return;
    // Marked tried only when it fires: leaving the page inside the delay must
    // not use up the one automatic opening.
    const timer = setTimeout(() => {
      autoTried.current = true;
      if (isTourPending()) setSession({ key: 1, initial: null });
    }, AUTO_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pathname, session]);

  if (!session) return null;
  return <Tour key={session.key} initial={session.initial} onClose={() => setSession(null)} />;
}
