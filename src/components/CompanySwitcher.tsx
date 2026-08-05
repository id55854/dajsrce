"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { COMPANY_ROLE_LABELS } from "@/lib/constants";
import type { CompanySwitcherItem } from "@/lib/company-switcher-items";
import { usePresence } from "@/components/ui";
import { useLocale, useT } from "@/i18n/client";

export type { CompanySwitcherItem } from "@/lib/company-switcher-items";

export function CompanySwitcher({
  items,
  activeId,
}: {
  items: CompanySwitcherItem[];
  activeId: string | null;
}) {
  const [open, setOpen] = useState(false);
  // Index of the visually focused option. The listbox itself owns DOM focus and
  // points at this option through `aria-activedescendant`, which is the ARIA
  // listbox pattern — options stay unfocusable so Tab never walks through them.
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const { locale } = useLocale();
  const t = useT();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const listboxId = useId();
  // Keeps the listbox mounted while its exit animation plays, so the popover
  // leaves along the path it arrived on instead of vanishing in one frame.
  const popover = usePresence(open);

  const closeAndRestore = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Move DOM focus into the menu on open so keyboard users land inside it.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  const active = items.find((c) => c.id === activeId) ?? items[0] ?? null;
  const multi = items.length > 1;

  if (!active) return null;

  const selectedIndex = Math.max(
    items.findIndex((c) => c.id === active.id),
    0
  );
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  function openMenu(startIndex: number) {
    setFocusedIndex(startIndex);
    setOpen(true);
  }

  function activate(item: CompanySwitcherItem) {
    document.cookie = `active_company=${item.id}; path=/; max-age=${60 * 60 * 24 * 180}; SameSite=Lax`;
    setOpen(false);
    triggerRef.current?.focus();
    // The cookie write is instant but the navigation + server re-render is not;
    // wrapping both keeps `pending` true for the whole round trip so the trigger
    // can show that something is happening.
    startTransition(() => {
      router.push(`/dashboard/company?cid=${item.id}`);
      router.refresh();
    });
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!multi || open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu(selectedIndex);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(items.length - 1);
    }
  }

  function handleListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        closeAndRestore();
        break;
      case "Tab":
        // Close and hand focus back to the trigger without preventDefault, so
        // the browser's own Tab handling continues from the trigger rather than
        // from a listbox that is about to unmount.
        closeAndRestore();
        break;
      case "ArrowDown":
        event.preventDefault();
        setFocusedIndex((i) => (i + 1) % items.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setFocusedIndex((i) => (i - 1 + items.length) % items.length);
        break;
      case "Home":
        event.preventDefault();
        setFocusedIndex(0);
        break;
      case "End":
        event.preventDefault();
        setFocusedIndex(items.length - 1);
        break;
      case "Enter":
      case " ": {
        event.preventDefault();
        const item = items[focusedIndex];
        if (item) activate(item);
        break;
      }
      default:
        break;
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          // With a single membership there is nothing to switch to, so the
          // trigger stays inert rather than claiming an expanded popup.
          if (!multi) return;
          if (open) setOpen(false);
          else openMenu(selectedIndex);
        }}
        onKeyDown={handleTriggerKeyDown}
        className={clsx(
          "inline-flex h-10 items-center gap-2 rounded-full border border-border-subtle bg-surface-raised px-3 text-sm font-medium text-ink",
          "transition duration-150 ease-out hover:bg-surface-sunken motion-safe:active:scale-[0.97]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
          pending && "opacity-60"
        )}
        aria-haspopup={multi ? "listbox" : undefined}
        aria-expanded={multi ? open : undefined}
        aria-controls={open && multi ? listboxId : undefined}
        aria-busy={pending || undefined}
      >
        <Building2 className="h-4 w-4 text-brand" aria-hidden="true" />
        <span className="max-w-[140px] truncate">{active.display_name || active.legal_name}</span>
        {multi ? (
          <ChevronsUpDown
            className={clsx(
              "h-3.5 w-3.5 text-ink-tertiary motion-safe:transition-transform motion-safe:duration-150",
              open && "rotate-180"
            )}
            aria-hidden="true"
          />
        ) : null}
      </button>
      {popover.present && multi ? (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-label={t("company.switcher_label")}
          aria-activedescendant={optionId(focusedIndex)}
          onKeyDown={handleListKeyDown}
          data-ui-motion
          data-state={popover.state}
          onAnimationEnd={popover.onAnimationEnd}
          className={clsx(
            "absolute right-0 z-[var(--z-dropdown)] mt-2 w-72 origin-top-right overflow-hidden",
            "rounded-card border border-border-subtle bg-surface-overlay py-1 shadow-overlay outline-none",
            "data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out",
            // Stop clicks landing on a surface that is already leaving.
            popover.state === "closed" && "pointer-events-none"
          )}
        >
          {items.map((item, index) => {
            const selected = item.id === active.id;
            const optionFocused = index === focusedIndex;
            const roleLabel = COMPANY_ROLE_LABELS[item.role];
            return (
              <div
                key={item.id}
                id={optionId(index)}
                role="option"
                aria-selected={selected}
                onClick={() => activate(item)}
                onMouseMove={() => setFocusedIndex(index)}
                className={clsx(
                  "flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                  selected ? "bg-brand-soft text-brand-on-soft" : "text-ink",
                  optionFocused && (selected ? "brightness-95" : "bg-surface-sunken")
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {item.display_name || item.legal_name}
                  </div>
                  <div className="truncate text-xs text-ink-tertiary">
                    {locale === "hr" ? roleLabel.labelHr : roleLabel.label}
                  </div>
                </div>
                {selected ? <Check className="h-4 w-4 text-brand" aria-hidden="true" /> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
