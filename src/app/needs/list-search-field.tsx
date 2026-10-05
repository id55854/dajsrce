"use client";

import { useId, useRef } from "react";
import clsx from "clsx";
import { Search, X } from "lucide-react";
import { SEARCH_CONTROL_CLASSES, inputClasses } from "@/components/ui";
import { LIST_SEARCH_MAX_QUERY_LENGTH } from "@/lib/list-search";

/**
 * The text search above the needs list on /doniraj and the events list on
 * /volunteer. It only filters rows the page has already loaded (see
 * `src/lib/list-search.ts`); nothing here talks to the server.
 */
export function ListSearchField({
  value,
  onChange,
  label,
  placeholder,
  clearLabel,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Read by screen readers; the placeholder says the same on screen. */
  label: string;
  placeholder: string;
  clearLabel: string;
  className?: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div role="search" className={clsx("relative", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary"
        aria-hidden
      />
      <input
        ref={inputRef}
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        maxLength={LIST_SEARCH_MAX_QUERY_LENGTH}
        autoComplete="off"
        enterKeyHint="search"
        className={inputClasses(
          clsx(
            "pl-10 pr-12 md:text-sm",
            SEARCH_CONTROL_CLASSES,
            // The browser's own clear affordance would sit beside the X below.
            "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
          )
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus({ preventScroll: true });
          }}
          aria-label={clearLabel}
          className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
