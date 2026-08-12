"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Remembers how the visitor chose to start, so the question is asked once and
 * never again. Any recorded value counts as answered — including "show the
 * whole country" — because re-asking someone who already declined is the
 * behaviour that makes a permission prompt feel like nagging.
 *
 * The hook lives apart from the dialogs it gates because the map page has a
 * client-bundle budget: the hook has to be in the initial chunk to decide
 * whether to ask, while the dialogs themselves are loaded only if it says yes.
 */
const START_PREFERENCE_KEY = "dajsrce-map-start";

export type MapStartPreference = "nearby" | "city" | "country";

export function useMapStartPrompt(): {
  /** Null until the stored preference has been read; never true on the server. */
  shouldAsk: boolean | null;
  resolve: (choice: MapStartPreference) => void;
} {
  const [shouldAsk, setShouldAsk] = useState<boolean | null>(null);

  useEffect(() => {
    // A shared or bookmarked view already says where to start; asking on top of
    // it would override an explicit intent with a prompt.
    if (new URLSearchParams(window.location.search).has("@")) {
      setShouldAsk(false);
      return;
    }
    try {
      setShouldAsk(window.localStorage.getItem(START_PREFERENCE_KEY) == null);
    } catch {
      // Private-mode storage failures must not gate the map behind a dialog.
      setShouldAsk(false);
    }
  }, []);

  const resolve = useCallback((choice: MapStartPreference) => {
    setShouldAsk(false);
    try {
      window.localStorage.setItem(START_PREFERENCE_KEY, choice);
    } catch {
      /* The choice still applies to this session. */
    }
  }, []);

  return { shouldAsk, resolve };
}
