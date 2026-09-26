"use client";

import { useEffect } from "react";
import { getDictionary, resolveKey } from "@/i18n/dictionaries";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunk-reload";

/**
 * The last boundary: it replaces the root layout when that layout itself
 * throws, so the locale provider, the stylesheet's tokens and the navbar are
 * all gone. It therefore renders its own document in Croatian, the site's
 * default and the only language a first-time visitor can have chosen, with
 * inline styles, instead of falling through to Next's English default.
 */
const copy = getDictionary("hr");
const text = (key: string) => resolveKey(copy, key);

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (reloadOnceForChunkError(error)) return;
    // The digest is the only safe correlation handle; the message may carry
    // internals, so it is never rendered.
    console.error("global error", { digest: error.digest });
  }, [error]);

  return (
    <html lang="hr">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#ffffff",
          color: "#111827",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>{text("errors.generic_title")}</h1>
          <p style={{ fontSize: 16, lineHeight: 1.5, color: "#4b5563", margin: "0 0 24px" }}>
            {text("errors.generic_body")}
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => (isChunkLoadError(error) ? window.location.reload() : reset())}
              style={{
                border: 0,
                borderRadius: 9999,
                padding: "12px 20px",
                background: "#dc2626",
                color: "#ffffff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {text("errors.retry")}
            </button>
            {/* A plain link on purpose: a full page load, because the client
                tree (router included) is what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                borderRadius: 9999,
                padding: "12px 20px",
                border: "1px solid #8b929d",
                color: "#111827",
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {text("errors.go_to_map")}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
