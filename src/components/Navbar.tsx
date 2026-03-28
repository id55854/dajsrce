"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, MapPin, Menu, X } from "lucide-react";
import clsx from "clsx";

const navLinks = [
  { href: "/map", label: "Karta" },
  { href: "/needs", label: "Potrebe" },
  { href: "/volunteer", label: "Volontiraj" },
  { href: "/quick-start", label: "Brzi start" },
] as const;

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={clsx(
        "text-sm font-medium transition-colors hover:text-red-500",
        active ? "text-red-500 underline underline-offset-4" : "text-gray-700"
      )}
    >
      {label}
    </Link>
  );
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 bg-white shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded-xl py-1 pr-2 transition-opacity hover:opacity-90"
          onClick={() => setMobileOpen(false)}
        >
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-500">
            <MapPin className="absolute h-4 w-4 text-red-400" strokeWidth={2} />
            <Heart className="relative h-5 w-5 fill-red-500 text-red-500" strokeWidth={2} />
          </span>
          <span className="text-xl font-semibold tracking-tight text-red-500">
            DajSrce
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Glavna navigacija">
          {navLinks.map(({ href, label }) => (
            <NavLink key={href} href={href} label={label} />
          ))}
        </nav>

        <div className="hidden md:block">
          <Link
            href="/auth/login"
            className="inline-flex items-center justify-center rounded-full border-2 border-red-500 px-5 py-2 text-sm font-semibold text-red-500 transition-colors hover:bg-red-50"
          >
            Prijava
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex rounded-xl p-2 text-gray-700 md:hidden"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label={mobileOpen ? "Zatvori izbornik" : "Otvori izbornik"}
          onClick={() => setMobileOpen((o) => !o)}
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {mobileOpen ? (
        <div
          id="mobile-nav"
          className="border-t border-gray-100 bg-white px-4 py-4 shadow-inner md:hidden"
        >
          <nav className="flex flex-col gap-3" aria-label="Mobilna navigacija">
            {navLinks.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    "rounded-xl px-3 py-2 text-base font-medium hover:bg-red-50",
                    active ? "text-red-500 underline underline-offset-4" : "text-gray-800"
                  )}
                  onClick={() => setMobileOpen(false)}
                >
                  {label}
                </Link>
              );
            })}
            <Link
              href="/auth/login"
              className="mt-2 inline-flex items-center justify-center rounded-full border-2 border-red-500 px-5 py-2.5 text-sm font-semibold text-red-500"
              onClick={() => setMobileOpen(false)}
            >
              Prijava
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
