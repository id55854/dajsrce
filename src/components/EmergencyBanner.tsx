"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

type EmergencyAlert = { title: string; message: string };

type EmergencyBannerProps = {
  alerts: EmergencyAlert[];
};

export function EmergencyBanner({ alerts }: EmergencyBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!alerts.length || dismissed) return null;

  return (
    <div
      className="relative z-[60] bg-red-600 px-4 py-3 text-white shadow-md"
      role="alert"
    >
      <div className="mx-auto flex max-w-7xl items-start gap-3 pr-10 sm:pr-12">
        <span className="mt-0.5 shrink-0 animate-pulse">
          <AlertTriangle className="h-5 w-5" strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          {alerts.map((a, i) => (
            <div key={i}>
              <p className="font-semibold">{a.title}</p>
              <p className="text-sm text-red-100">{a.message}</p>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute right-3 top-3 rounded-lg p-1 text-red-100 transition-colors hover:bg-red-700 hover:text-white"
          aria-label="Dismiss alert"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
