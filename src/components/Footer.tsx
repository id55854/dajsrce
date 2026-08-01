"use client";

import { Heart } from "lucide-react";
import { useT } from "@/i18n/client";

export function Footer() {
  const t = useT();
  const year = new Date().getFullYear();

  return (
    <footer className="bg-gray-50 py-8 text-gray-500 dark:bg-gray-900 dark:text-gray-500">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 text-center sm:px-6 lg:px-8">
        <p className="flex flex-wrap items-center justify-center gap-2 text-sm sm:text-base">
          <span className="font-medium text-gray-600 dark:text-gray-300">DajSrce</span>
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
