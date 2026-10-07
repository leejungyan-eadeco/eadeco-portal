"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Buildings, CalendarCheck, Car, ClockCounterClockwise, House, List, PlugsConnected, Receipt, SignOut, UsersThree, X, type Icon } from "@phosphor-icons/react";
import type { CurrentUser } from "@/lib/auth";
import { logout } from "./login/actions";
import { Badge } from "./ui";

const groups: {
  adminOnly?: boolean; label?: string; items: { href: string; label: string; icon: Icon; soon?: boolean }[] }[] = [
  { items: [{ href: "/", label: "Overview", icon: House }] },
  {
    label: "Automation",
    items: [
      { href: "/automation/recurring-invoices", label: "Recurring invoices", icon: Receipt },
      { href: "/automation/parking-reports", label: "Parking reports", icon: Car, soon: true },
      { href: "/runs", label: "Run history", icon: ClockCounterClockwise },
    ],
  },
  {
    label: "Settings",
    adminOnly: true,
    items: [
      { href: "/settings/companies", label: "Companies", icon: Buildings },
      { href: "/settings/nav", label: "NAV connection", icon: PlugsConnected },
      { href: "/settings/scheduler", label: "Scheduler", icon: CalendarCheck },
      { href: "/settings/users", label: "Users", icon: UsersThree },
    ],
  },
];

// The gold house from the original logo, with the name set as text beside it (side-by-side lockup).
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" aria-label="EADEPRO Business Portal, home" className="flex items-center gap-3 rounded-lg">
      <img src="/logo-mark.png" alt="" className={compact ? "h-6 w-auto" : "h-8 w-auto"} />
      <span className="flex flex-col gap-1 leading-none">
        <span className="font-display text-[18px] font-bold tracking-wide text-brand">EADEPRO</span>
        {!compact && <span className="text-[11px] font-medium text-accent-ink">Business Portal</span>}
      </span>
    </Link>
  );
}

export function Shell({ children, user }: { children: React.ReactNode; user: CurrentUser | null }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // The login page has no sidebar.
  if (path === "/login" || !user) return <>{children}</>;

  return (
    <div className="min-h-dvh">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur lg:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="-ml-2 rounded-lg p-2 text-ink-2 hover:bg-subtle active:translate-y-px"
        >
          <List size={20} />
        </button>
        <Brand compact />
      </header>

      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-sidebar transition-transform duration-200 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="relative border-b border-line px-4 py-4">
          <Brand />
          <button onClick={() => setOpen(false)} aria-label="Close navigation" className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg p-1.5 text-ink-3 hover:bg-black/5 lg:hidden">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
          {groups.filter((g) => !g.adminOnly || user.role === "admin").map((g, i) => (
            <div key={i} className={i ? "mt-6" : ""}>
              {g.label && <div className="mb-1 px-2 text-xs font-medium text-ink-3">{g.label}</div>}
              <ul className="space-y-0.5">
                {g.items.map(({ href, label, icon: Icon, soon }) => {
                  const active = path === href;
                  // Not built yet: shown so people know it is coming, but not clickable.
                  if (soon)
                    return (
                      <li key={href}>
                        <span aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-ink-3/70">
                          <Icon size={18} className="text-ink-3/60" />
                          {label}
                          <Badge className="ml-auto px-1.5 py-px text-[10px]">Soon</Badge>
                        </span>
                      </li>
                    );
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                          active
                            ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgb(28_25_23/0.06)] ring-1 ring-line"
                            : "text-ink-2 hover:bg-black/[0.03] hover:text-ink dark:hover:bg-white/[0.05]"
                        }`}
                      >
                        <Icon size={18} weight={active ? "fill" : "regular"} className={active ? "text-accent" : "text-ink-3"} />
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-on-accent" aria-hidden>
            {user.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm font-medium" title={user.name}>
              {user.name}
            </span>
            <span className="truncate text-xs text-ink-3">
              EADECO\{user.username} · {user.role === "admin" ? "Admin" : "User"}
            </span>
          </span>
          <form action={logout}>
            <button type="submit" title="Sign out" aria-label="Sign out" className="rounded-lg p-1.5 text-ink-3 hover:bg-black/5 hover:text-ink dark:hover:bg-white/10">
              <SignOut size={18} />
            </button>
          </form>
        </div>
      </aside>

      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-8 md:px-10 md:py-10">{children}</div>
      </main>
    </div>
  );
}
