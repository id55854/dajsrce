"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Heart, LogOut, MapPin, Menu, User, X } from "lucide-react";
import clsx from "clsx";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Notification } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { CompanySwitcher, type CompanySwitcherItem } from "@/components/CompanySwitcher";

const navLinks = [
  { href: "/map", label: "Map" },
  { href: "/needs", label: "Needs" },
  { href: "/volunteer", label: "Volunteer" },
  { href: "/quick-start", label: "Quick Start" },
] as const;

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={clsx(
        "text-sm font-medium transition-colors hover:text-red-500",
        active ? "text-red-500 underline underline-offset-4" : "text-gray-700 dark:text-gray-300"
      )}
    >
      {label}
    </Link>
  );
}

function saveUserLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      fetch("/api/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      }).catch(() => {});
    },
    () => {},
    { enableHighAccuracy: false, timeout: 10000 }
  );
}

function NotificationPanel({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onClose,
}: {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full z-[60] mt-2 w-80 max-h-[70vh] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:shadow-gray-950/50 sm:w-96"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Notifications {unreadCount > 0 ? `(${unreadCount})` : ""}
        </h3>
        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-xs font-medium text-red-500 hover:text-red-600"
          >
            Mark all read
          </button>
        ) : null}
      </div>

      <div className="max-h-[60vh] overflow-y-auto">
        {notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            No notifications yet
          </p>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={clsx(
                "border-b border-gray-50 px-4 py-3 transition-colors dark:border-gray-800",
                n.is_read ? "bg-white dark:bg-gray-900" : "bg-red-50/50 dark:bg-red-950/30"
              )}
            >
              {n.link ? (
                <Link
                  href={n.link}
                  onClick={() => {
                    if (!n.is_read) onMarkRead(n.id);
                    onClose();
                  }}
                  className="block"
                >
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{n.title}</p>
                  <p className="mt-0.5 text-xs text-gray-600 line-clamp-2 dark:text-gray-400">{n.body}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
                </Link>
              ) : (
                <div
                  onClick={() => { if (!n.is_read) onMarkRead(n.id); }}
                  className="cursor-pointer"
                >
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{n.title}</p>
                  <p className="mt-0.5 text-xs text-gray-600 line-clamp-2 dark:text-gray-400">{n.body}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<SupaUser | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [companies, setCompanies] = useState<CompanySwitcherItem[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [meProfile, setMeProfile] = useState<{ name: string; email: string } | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setUser(null);
      return;
    }

    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) {
        saveUserLocation();
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        saveUserLocation();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setMeProfile(null);
      return;
    }
    let cancelled = false;
    fetch("/api/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { profile?: { name: string; email: string } } | null) => {
        if (cancelled || !data?.profile) return;
        setMeProfile({ name: data.profile.name, email: data.profile.email });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setCompanies([]);
      setActiveCompanyId(null);
      return;
    }
    function fetchNotifications() {
      fetch("/api/notifications", { credentials: "include" })
        .then((r) => r.json())
        .then((data) => setNotifications(data.notifications ?? []))
        .catch(() => {});
    }
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);

    // Fetch company memberships once per session; the switcher only
    // renders when the user belongs to at least two companies.
    fetch("/api/companies", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { companies?: Array<{ id: string; slug: string; display_name: string | null; legal_name: string; logo_url: string | null; member_role: CompanySwitcherItem["role"] }> }) => {
        const list = (data.companies ?? []).map((c) => ({
          id: c.id,
          slug: c.slug,
          display_name: c.display_name,
          legal_name: c.legal_name,
          logo_url: c.logo_url,
          role: c.member_role,
        }));
        setCompanies(list);
        if (list.length > 0) {
          const stored = document.cookie
            .split("; ")
            .find((c) => c.startsWith("active_company="))
            ?.split("=")[1];
          setActiveCompanyId(stored ?? list[0]!.id);
        }
      })
      .catch(() => {});
    return () => clearInterval(interval);
  }, [user]);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark_all_read: true }),
    }).catch(() => {});
  }, []);

  async function handleLogout() {
    if (!isSupabaseConfigured) {
      setUser(null);
      setNotifications([]);
      router.push("/map");
      return;
    }

    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setNotifications([]);
    router.push("/map");
    router.refresh();
  }

  const displayName =
    meProfile?.name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "User";

  const profileEmail = meProfile?.email || user?.email || undefined;

  return (
    <header className="sticky top-0 z-50 bg-white shadow-sm dark:bg-gray-950 dark:shadow-gray-900/50">
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

        <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
          {navLinks.map(({ href, label }) => (
            <NavLink key={href} href={href} label={label} />
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <LocaleSwitcher />
          <ThemeToggle />
          {user && companies.length > 1 ? (
            <CompanySwitcher items={companies} activeId={activeCompanyId} />
          ) : null}
          {user ? (
            <>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPanelOpen((o) => !o)}
                  className="relative inline-flex items-center rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  aria-label="Notifications"
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </button>
                {panelOpen ? (
                  <NotificationPanel
                    notifications={notifications}
                    onMarkRead={markRead}
                    onMarkAllRead={markAllRead}
                    onClose={() => setPanelOpen(false)}
                  />
                ) : null}
              </div>
              <Link
                href="/dashboard"
                title={profileEmail}
                className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:bg-red-950 dark:text-red-300"
              >
                <User className="h-4 w-4" />
                {displayName}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          ) : (
            <Link
              href="/auth/login"
              className="inline-flex items-center justify-center rounded-full border-2 border-red-500 px-5 py-2 text-sm font-semibold text-red-500 transition-colors hover:bg-red-50"
            >
              Sign In
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          {user && unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => setPanelOpen((o) => !o)}
              className="relative inline-flex items-center rounded-xl p-2 text-gray-700"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex rounded-xl p-2 text-gray-700 dark:text-gray-300"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {panelOpen && (
        <div className="md:hidden">
          <NotificationPanel
            notifications={notifications}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
            onClose={() => setPanelOpen(false)}
          />
        </div>
      )}

      {mobileOpen ? (
        <div
          id="mobile-nav"
          className="border-t border-gray-100 bg-white px-4 py-4 shadow-inner dark:border-gray-800 dark:bg-gray-950 md:hidden"
        >
          <nav className="flex flex-col gap-3" aria-label="Mobile navigation">
            {navLinks.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    "rounded-xl px-3 py-2 text-base font-medium hover:bg-red-50",
                    active ? "text-red-500 underline underline-offset-4" : "text-gray-800 dark:text-gray-200 dark:hover:bg-gray-800"
                  )}
                  onClick={() => setMobileOpen(false)}
                >
                  {label}
                </Link>
              );
            })}
            {user ? (
              <>
                <Link
                  href="/dashboard"
                  title={profileEmail}
                  className="rounded-xl px-3 py-2 text-base font-medium text-red-500 hover:bg-red-50 dark:hover:bg-gray-800"
                  onClick={() => setMobileOpen(false)}
                >
                  {displayName}
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    handleLogout();
                  }}
                  className="rounded-xl px-3 py-2 text-left text-base font-medium text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <Link
                href="/auth/login"
                className="mt-2 inline-flex items-center justify-center rounded-full border-2 border-red-500 px-5 py-2.5 text-sm font-semibold text-red-500"
                onClick={() => setMobileOpen(false)}
              >
                Sign In
              </Link>
            )}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
