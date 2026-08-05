"use client";

import { Heart } from "lucide-react";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/client";

// `/map` is a fixed-height, full-viewport application surface. Rendering the
// global footer under it makes the document taller than the viewport, so the
// page scrolls and wheel/touch scrolling over the map zooms it instead. The
// footer is mounted from the root layout, so the route exclusion lives here.
const FOOTERLESS_PREFIXES = ["/map"];

export function Footer() {
  const t = useT();
  const pathname = usePathname();
  const year = new Date().getFullYear();

  const hidden = FOOTERLESS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (hidden) return null;

  return (
    <footer className="bg-gray-50 py-8 text-gray-600 dark:bg-gray-950 dark:text-gray-400">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 text-center sm:px-6 lg:px-8">
        <p className="flex flex-wrap items-center justify-center gap-2 text-sm text-gray-700 sm:text-base dark:text-gray-300">
          <span className="font-medium text-gray-900 dark:text-gray-100">DajSrce</span>
          <Heart
            className="inline h-4 w-4 fill-red-400 text-red-400"
            strokeWidth={2}
            aria-hidden
          />
          <span>{t("footer.tagline")}</span>
        </p>
        <p className="text-sm">{t("footer.public_good", { year })}</p>
      </div>
    </footer>
  );
}
