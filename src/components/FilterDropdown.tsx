"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import clsx from "clsx";
import { useT } from "@/i18n/client";

type Option<T extends string> = { value: T; label: string; description?: string; key?: string };

/** Native popover stays above map panes and outside scroll-container clipping.
 * Checkbox/radio inputs retain native keyboard semantics and touch targets. */
export function FilterDropdown<T extends string>({
  label, options, value, onChange, allLabel, multiple = false, searchable = false,
  searchLabel, emptyLabel, selectedLabel, loading = false, error,
  onSearchChange, onOpenChange,
}: {
  label: string;
  options: Option<T>[];
  value: T[];
  onChange: (value: T[]) => void;
  allLabel: string;
  multiple?: boolean;
  searchable?: boolean;
  searchLabel?: string;
  emptyLabel?: string;
  selectedLabel?: string;
  loading?: boolean;
  error?: string | null;
  onSearchChange?: (query: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number }>({ top: 0, left: 0, width: 300, maxHeight: 400 });
  useEffect(() => {
    if (!open) return;
    const dismiss = () => panel.current?.hidePopover();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
      trigger.current?.focus();
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      dismiss();
    };
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);
  const selected = options.filter((option) => value.includes(option.value));
  const summary = selectedLabel ?? (selected.length === 0 ? allLabel : selected.length === 1
    ? selected[0].label : t("filters.selected_count", { count: selected.length }));
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const visible = onSearchChange ? options : options.filter((option) => normalize(option.label).includes(normalize(query.trim())));

  function close() {
    panel.current?.hidePopover();
    trigger.current?.focus();
  }

  function toggle() {
    if (open) return close();
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const height = Math.min(400, Math.max(below, above));
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      ...(below >= Math.min(400, above) ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
      width,
      maxHeight: Math.max(160, height - 6),
    });
    setQuery("");
    onSearchChange?.("");
    panel.current?.showPopover();
  }

  return (
    <div className="min-w-0 flex-1 basis-48">
      <span id={`${id}-label`} className="mb-1.5 block text-xs font-semibold text-ink-secondary">{label}</span>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={toggle}
        className={clsx("flex min-h-11 w-full items-center gap-2 rounded-control border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          value.length ? "border-brand bg-brand-soft text-brand-on-soft" : "border-border-subtle bg-surface-raised text-ink hover:border-border-strong")}
      >
        <span id={`${id}-value`} className="min-w-0 flex-1 truncate">{summary}</span>
        <ChevronDown className={clsx("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="group"
        aria-labelledby={`${id}-label`}
        style={{ top: "auto", bottom: "auto", ...position, margin: 0, position: "fixed" }}
        className="overflow-y-auto rounded-card border border-border-subtle bg-surface-overlay p-2 text-ink shadow-overlay"
        onToggle={(event) => {
          const expanded = event.newState === "open";
          setOpen(expanded);
          onOpenChange?.(expanded);
          if (expanded) search.current?.focus();
        }}
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) panel.current?.hidePopover();
        }}
      >
        {searchable ? (
          <label className="mb-2 flex items-center gap-2 rounded-control border border-border-subtle px-3 focus-within:ring-2 focus-within:ring-brand">
            <Search className="h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
            <input ref={search} aria-label={searchLabel ?? t("filters.search_options")} placeholder={searchLabel ?? t("filters.search_options")} value={query} onChange={(event) => { setQuery(event.target.value); onSearchChange?.(event.target.value); }} className="h-11 w-full min-w-0 bg-transparent text-base outline-none" />
          </label>
        ) : null}
        <button type="button" onClick={() => { onChange([]); if (!multiple) close(); }} className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <span className="w-4 shrink-0">{value.length === 0 ? <Check className="h-4 w-4 text-brand" aria-hidden /> : null}</span>
          {allLabel}
        </button>
        <div className="my-1 border-t border-border-subtle" />
        {!loading && !error ? visible.map((option) => (
          <label key={option.key ?? option.value} className={clsx("flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-sm hover:bg-surface-sunken focus-within:ring-2 focus-within:ring-brand", value.includes(option.value) && "bg-brand-soft text-brand-on-soft")}>
            <input
              type={multiple ? "checkbox" : "radio"}
              name={id}
              checked={value.includes(option.value)}
              onChange={() => {
                onChange(multiple ? value.includes(option.value) ? value.filter((entry) => entry !== option.value) : [...value, option.value] : [option.value]);
                if (!multiple) close();
              }}
              className="h-4 w-4 shrink-0 accent-brand"
            />
            <span className="min-w-0"><span className="block">{option.label}</span>{option.description ? <span className="block text-xs text-ink-secondary">{option.description}</span> : null}</span>
          </label>
        )) : null}
        {loading ? <p role="status" className="px-3 py-4 text-sm text-ink-secondary">{t("common.loading")}</p> : error ? <p role="alert" className="px-3 py-4 text-sm text-ink-secondary">{error}</p> : visible.length === 0 ? <p className="px-3 py-4 text-sm text-ink-secondary">{emptyLabel ?? t("filters.no_options")}</p> : null}
        {multiple ? <div className="sticky -bottom-2 mt-2 border-t border-border-subtle bg-surface-overlay pt-2 pb-1"><button type="button" onClick={close} className="min-h-11 w-full rounded-control bg-brand px-3 text-sm font-semibold text-white">{t("filters.done")}</button></div> : null}
      </div>
    </div>
  );
}
