"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Accessibility,
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

  if (s.dyslexiaFont && !document.getElementById("dyslexia-font-link")) {
    const link = document.createElement("link");
    link.id = "dyslexia-font-link";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=OpenDyslexic&display=swap";
    document.head.appendChild(link);
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
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState<A11ySettings>(DEFAULTS);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

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

  const close = useCallback(() => setIsOpen(false), []);

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
    { key: "highContrast", label: "High Contrast", icon: <Contrast className="h-5 w-5" /> },
    { key: "dyslexiaFont", label: "Dyslexia Font", icon: <Type className="h-5 w-5" /> },
    { key: "highlightLinks", label: "Highlight Links", icon: <LinkIcon className="h-5 w-5" /> },
    { key: "increaseSpacing", label: "Increase Spacing", icon: <Space className="h-5 w-5" /> },
    { key: "grayscale", label: "Grayscale", icon: <Palette className="h-5 w-5" /> },
    { key: "bigCursor", label: "Big Cursor", icon: <MousePointer2 className="h-5 w-5" /> },
    { key: "stopAnimations", label: "Stop Animations", icon: <Pause className="h-5 w-5" /> },
  ];

  return (
    <>
      {isOpen ? (
        <div className="fixed inset-0 z-40" onClick={close} aria-hidden />
      ) : null}

      {isOpen ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Accessibility settings"
          aria-modal="true"
          className="a11y-panel-enter fixed bottom-20 left-4 z-50 w-80 rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <Accessibility className="h-5 w-5 text-red-500" />
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Accessibility
              </span>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              aria-label="Close accessibility menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="max-h-[70vh] space-y-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between rounded-xl px-2 py-2">
              <div className="flex items-center gap-3">
                <Eye className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Text Size
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => adjustFontSize(-10)}
                  disabled={settings.fontSize <= 90}
                  aria-label="Decrease font size"
                  className="rounded-lg px-2 py-1 text-xs font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  A-
                </button>
                <button
                  type="button"
                  onClick={resetFontSize}
                  aria-label="Reset font size"
                  className="rounded-lg px-2 py-1 text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  {settings.fontSize}%
                </button>
                <button
                  type="button"
                  onClick={() => adjustFontSize(10)}
                  disabled={settings.fontSize >= 150}
                  aria-label="Increase font size"
                  className="rounded-lg px-2 py-1 text-xs font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  A+
                </button>
              </div>
            </div>

            {features.map(({ key, label, icon }) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-xl px-2 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 dark:text-gray-400">{icon}</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
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

          <div className="border-t border-gray-200 p-4 dark:border-gray-700">
            <button
              type="button"
              onClick={resetAll}
              aria-label="Reset all accessibility settings"
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:border-red-500 hover:text-red-500 dark:border-gray-700 dark:text-gray-300 dark:hover:border-red-500 dark:hover:text-red-500"
            >
              <RotateCcw className="h-4 w-4" />
              Reset All Settings
            </button>
          </div>
        </div>
      ) : null}

      <button
        ref={toggleRef}
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="fixed bottom-4 left-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        aria-label="Open accessibility menu"
        aria-expanded={isOpen}
      >
        <Accessibility className="h-6 w-6" />
      </button>
    </>
  );
}
