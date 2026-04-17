"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import type { Company, CompanyRole } from "@/lib/types";
import { COMPANY_ROLE_LABELS } from "@/lib/constants";
import { useLocale } from "@/i18n/client";

export type CompanySwitcherItem = {
  id: string;
  slug: string;
  display_name: string | null;
  legal_name: string;
  logo_url: string | null;
  role: CompanyRole;
};

export function CompanySwitcher({
  items,
  activeId,
}: {
  items: CompanySwitcherItem[];
  activeId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { locale } = useLocale();
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const active = items.find((c) => c.id === activeId) ?? items[0] ?? null;

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  if (!active) return null;

  function activate(item: CompanySwitcherItem) {
    document.cookie = `active_company=${item.id}; path=/; max-age=${60 * 60 * 24 * 180}; SameSite=Lax`;
    setOpen(false);
    router.push(`/dashboard/company?cid=${item.id}`);
    router.refresh();
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Building2 className="h-4 w-4 text-red-500" aria-hidden="true" />
        <span className="truncate max-w-[140px]">{active.display_name || active.legal_name}</span>
        {items.length > 1 ? <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" /> : null}
      </button>
      {open && items.length > 1 ? (
        <div
          className="absolute right-0 z-[70] mt-2 w-72 rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
          role="listbox"
        >
          <ul className="py-1">
            {items.map((item) => {
              const selected = item.id === active.id;
              const roleLabel = COMPANY_ROLE_LABELS[item.role];
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => activate(item)}
                    role="option"
                    aria-selected={selected}
                    className={clsx(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                        : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {item.display_name || item.legal_name}
                      </div>
                      <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {locale === "hr" ? roleLabel.labelHr : roleLabel.label}
                      </div>
                    </div>
                    {selected ? <Check className="h-4 w-4 text-red-500" aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function toSwitcherItems(
  memberships: Array<{ company: Company; role: CompanyRole }>
): CompanySwitcherItem[] {
  return memberships.map(({ company, role }) => ({
    id: company.id,
    slug: company.slug,
    display_name: company.display_name,
    legal_name: company.legal_name,
    logo_url: company.logo_url,
    role,
  }));
}
