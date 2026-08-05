"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  RotateCcw,
  Type,
  Contrast,
  Eye,
  MousePointer2,
  Space,
  Pause,
  Link as LinkIcon,
  Palette,
} from "lucide-react";
import { usePresence } from "@/components/ui";
import { useT } from "@/i18n/client";

function A11yIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      fill="currentColor"
      className={className}
    >
      <path d="M256 48a208 208 0 1 1 0 416 208 208 0 0 1 0-416Zm0-48a256 256 0 1 0 0 512 256 256 0 0 0 0-512Z" />
      <circle cx="256" cy="152" r="36" />
      <path d="M164 212c-3 0-5 2-5 5v18c0 3 2 5 5 5h60v56l-36 104c-1 3 0 6 3 7l17 6c3 1 6 0 7-3l33-95h16l33 95c1 3 4 4 7 3l17-6c3-1 4-4 3-7l-36-104v-56h60c3 0 5-2 5-5v-18c0-3-2-5-5-5H164Z" />
    </svg>
  );
}

type A11ySettings = {
  fontSize: number;
  highContrast: boolean;
  dyslexiaFont: boolean;
  highlightLinks: boolean;
  increaseSpacing: boolean;
  grayscale: boolean;
  bigCursor: boolean;
  stopAnimations: boolean;
};

const DEFAULTS: A11ySettings = {
  fontSize: 100,
  highContrast: false,
  dyslexiaFont: false,
  highlightLinks: false,
  increaseSpacing: false,
  grayscale: false,
  bigCursor: false,
  stopAnimations: false,
};

const STORAGE_KEY = "dajsrce-a11y";

// 40px minimum on controls that users of this very menu are the most
// likely to need to hit accurately.
const STEPPER_BUTTON =
  "inline-flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-ink transition-colors hover:bg-surface-sunken disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-safe:active:scale-[0.95]";

const CLASS_MAP: Record<string, string> = {
  highContrast: "high-contrast",
  dyslexiaFont: "dyslexia-font",
  highlightLinks: "highlight-links",
  increaseSpacing: "increase-spacing",
  grayscale: "grayscale-mode",
  bigCursor: "big-cursor",
  stopAnimations: "stop-animations",
};

function applySettings(s: A11ySettings) {
  const root = document.documentElement;
  root.style.fontSize = `${s.fontSize}%`;

  for (const [key, cls] of Object.entries(CLASS_MAP)) {
    root.classList.toggle(cls, s[key as keyof A11ySettings] as boolean);
  }

}

function clearSettings() {
  const root = document.documentElement;
  root.style.fontSize = "";
  for (const cls of Object.values(CLASS_MAP)) {
    root.classList.remove(cls);
  }
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-red-500" : "bg-gray-200 dark:bg-gray-700"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function AccessibilityMenu() {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState<A11ySettings>(DEFAULTS);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Symmetric enter/exit: the panel used to slide up on open and then
  // vanish in a single frame on close.
  const panel = usePresence(isOpen);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = { ...DEFAULTS, ...JSON.parse(stored) };
        setSettings(parsed);
        applySettings(parsed);
      }
    } catch {}
  }, []);

  const persist = useCallback((next: A11ySettings) => {
    setSettings(next);
    applySettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    requestAnimationFrame(() => toggleRef.current?.focus());
  }, []);

  const resetAll = useCallback(() => {
    clearSettings();
    setSettings(DEFAULTS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const toggleSetting = useCallback(
    (key: keyof A11ySettings) => {
      const next = { ...settings, [key]: !settings[key] };
      persist(next);
    },
    [settings, persist]
  );

  const adjustFontSize = useCallback(
    (delta: number) => {
      const next = {
        ...settings,
        fontSize: Math.min(150, Math.max(90, settings.fontSize + delta)),
      };
      persist(next);
    },
    [settings, persist]
  );

  const resetFontSize = useCallback(() => {
    persist({ ...settings, fontSize: 100 });
  }, [settings, persist]);

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const features: {
    key: keyof A11ySettings;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { key: "highContrast", label: t("a11y.high_contrast"), icon: <Contrast className="h-5 w-5" /> },
    { key: "dyslexiaFont", label: t("a11y.dyslexia_font"), icon: <Type className="h-5 w-5" /> },
    { key: "highlightLinks", label: t("a11y.highlight_links"), icon: <LinkIcon className="h-5 w-5" /> },
    { key: "increaseSpacing", label: t("a11y.increase_spacing"), icon: <Space className="h-5 w-5" /> },
    { key: "grayscale", label: t("a11y.grayscale"), icon: <Palette className="h-5 w-5" /> },
    { key: "bigCursor", label: t("a11y.big_cursor"), icon: <MousePointer2 className="h-5 w-5" /> },
    { key: "stopAnimations", label: t("a11y.stop_animations"), icon: <Pause className="h-5 w-5" /> },
  ];

  return (
    <>
      {/* The panel traps focus, so it is a modal task and earns a dimming
          scrim — previously the overlay was fully transparent. */}
      {panel.present ? (
        <div
          data-ui-motion
          data-state={panel.state}
          className="fixed inset-0 z-[var(--z-modal)] bg-scrim data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out"
          onClick={close}
          aria-hidden
        />
      ) : null}

      {panel.present ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t("a11y.dialog_label")}
          aria-modal="true"
          data-ui-motion
          data-state={panel.state}
          onAnimationEnd={panel.onAnimationEnd}
          className="fixed bottom-20 left-4 z-[var(--z-modal)] w-80 origin-bottom-left rounded-card border border-border-subtle bg-surface-overlay shadow-modal data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out"
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <A11yIcon className="h-5 w-5 text-brand" aria-hidden="true" />
              <span className="text-sm font-semibold text-ink">
                {t("a11y.title")}
              </span>
            </div>
            <button
              type="button"
              onClick={close}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.92]"
              aria-label={t("a11y.close")}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="max-h-[70dvh] space-y-1 overflow-y-auto overscroll-contain p-4">
            <div className="flex items-center justify-between rounded-control px-2 py-2">
              <div className="flex items-center gap-3">
                <Eye className="h-5 w-5 text-ink-tertiary" aria-hidden="true" />
                <span className="text-sm font-medium text-ink">
                  {t("a11y.text_size")}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => adjustFontSize(-10)}
                  disabled={settings.fontSize <= 90}
                  aria-label={t("a11y.decrease_text")}
                  className={STEPPER_BUTTON}
                >
                  A-
                </button>
                <button
                  type="button"
                  onClick={resetFontSize}
                  aria-label={t("a11y.reset_text")}
                  className="inline-flex h-10 min-w-12 items-center justify-center rounded-full text-xs font-bold tabular-nums text-brand transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-safe:active:scale-[0.95]"
                >
                  {settings.fontSize}%
                </button>
                <button
                  type="button"
                  onClick={() => adjustFontSize(10)}
                  disabled={settings.fontSize >= 150}
                  aria-label={t("a11y.increase_text")}
                  className={STEPPER_BUTTON}
                >
                  A+
                </button>
              </div>
            </div>

            {features.map(({ key, label, icon }) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-control px-2 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="text-ink-tertiary" aria-hidden="true">{icon}</span>
                  <span className="text-sm font-medium text-ink">
                    {label}
                  </span>
                </div>
                <Toggle
                  checked={settings[key] as boolean}
                  onChange={() => toggleSetting(key)}
                  label={label}
                />
              </div>
            ))}
          </div>

          <div className="border-t border-border-subtle p-4">
            <button
              type="button"
              onClick={resetAll}
              aria-label={t("a11y.reset_all")}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border-subtle text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.97]"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t("a11y.reset_all")}
            </button>
          </div>
        </div>
      ) : null}

      <button
        ref={toggleRef}
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-[var(--z-chrome)] flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-overlay transition-transform duration-150 ease-out hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.94]"
        aria-label={t("a11y.open")}
        aria-expanded={isOpen}
      >
        <A11yIcon className="h-7 w-7" aria-hidden="true" />
      </button>
    </>
  );
}
