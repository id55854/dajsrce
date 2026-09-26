"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui";
import { useT } from "@/i18n/client";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunk-reload";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    // A tab left open across a deploy asks for chunks that no longer exist;
    // loading the current build is the whole fix, so do that once.
    if (reloadOnceForChunkError(error)) return;
    // The digest is the only safe correlation handle here: the message may
    // carry internals, so it is never rendered to the user.
    console.error("route error", { digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-warning-soft text-warning">
        <AlertTriangle className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">
        {t("errors.generic_title")}
      </h1>
      <p className="text-base text-ink-secondary">{t("errors.generic_body")}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Button onClick={() => (isChunkLoadError(error) ? window.location.reload() : reset())}>
          {t("errors.retry")}
        </Button>
        {/* Retrying does not help every failure; the map always is a way on. */}
        <Link href="/" className={buttonClasses({ variant: "secondary" })}>
          {t("errors.go_to_map")}
        </Link>
      </div>
    </div>
  );
}
