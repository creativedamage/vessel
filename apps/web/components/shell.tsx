"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity, Boxes, Building2, LayoutDashboard, LogOut, Menu, Moon, ScanLine, Sun, TabletSmartphone, Users, X,
} from "lucide-react";
import { api, useApi } from "@/lib/api";
import type { Me } from "@/lib/types";
import { cx, Skeleton } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/checkout", label: "Check out / in", icon: ScanLine },
  { href: "/assets", label: "Assets", icon: Boxes },
  { href: "/places", label: "Campuses & Ministries", icon: Building2 },
  { href: "/people", label: "People", icon: Users },
  { href: "/kiosks", label: "Volunteer devices", icon: TabletSmartphone, minRole: "ADMIN" as const },
  { href: "/activity", label: "Activity", icon: Activity },
];

const RANK = { VIEWER: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 };

export function useMe() {
  return useApi<Me>("/me", { revalidateOnFocus: false });
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("vessel-theme", next ? "dark" : "light");
    } catch {}
  };
  return (
    <button onClick={toggle} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800" aria-label="Toggle dark mode">
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-brand-600" />
      <path d="M8 11c2.5 7 5 10 8 10s5.5-3 8-10" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="16" cy="9.5" r="2" fill="#fbbf24" />
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  };

  const nav = NAV.filter((n) => !n.minRole || (me && RANK[me.person.role] >= RANK[n.minRole]));

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Logo className="size-8" />
        <div className="min-w-0">
          <div className="font-semibold leading-tight">Vessel</div>
          <div className="truncate text-xs text-stone-500">{me?.organization.name ?? " "}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cx(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
                  : "text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/60 dark:hover:text-stone-100",
              )}
            >
              <Icon className="size-[18px]" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-stone-200 p-3 dark:border-stone-800">
        <div className="flex items-center gap-2 rounded-xl px-2 py-1.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold dark:bg-stone-800">
            {me ? me.person.displayName.split(" ").map((p) => p[0]).slice(0, 2).join("") : ""}
          </div>
          <div className="min-w-0 flex-1">
            {me ? (
              <>
                <div className="truncate text-sm font-medium">{me.person.displayName}</div>
                <div className="text-xs capitalize text-stone-500">{me.person.role.toLowerCase()}</div>
              </>
            ) : (
              <Skeleton className="h-8 w-24" />
            )}
          </div>
          <ThemeToggle />
          <button onClick={logout} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" aria-label="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-stone-200 bg-white/70 backdrop-blur lg:block dark:border-stone-800 dark:bg-stone-900/50">
        {sidebar}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-stone-950/40" />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white dark:bg-stone-900" onClick={(e) => e.stopPropagation()}>
            <button className="absolute right-3 top-5 p-1" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-stone-200 bg-white/80 px-4 py-3 backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-900/80">
          <button onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <Logo className="size-6" />
          <span className="font-semibold">Vessel</span>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
