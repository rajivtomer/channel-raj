"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/app/actions/auth";
import { Logo } from "./icons";

const NAV: { href: string; label: string; soon?: string }[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/compose", label: "Compose" },
  { href: "/calendar", label: "Calendar & queue" },
  { href: "/library", label: "Media library" },
  { href: "/inbox", label: "Inbox" },
  { href: "/automations", label: "Automations" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings/api", label: "API & channels" },
];

export function Sidebar({ user, inboxOpen = 0 }: { user: { name: string; email: string }; inboxOpen?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between border-b border-line bg-panel px-4 py-3 md:hidden">
        <span className="flex items-center gap-2 font-semibold"><Logo className="size-6" /> Channel Toolkit</span>
        <button className="btn-ghost px-2.5 py-1.5" onClick={() => setOpen(!open)} aria-expanded={open}>
          Menu
        </button>
      </div>
      <aside
        className={`${open ? "block" : "hidden"} border-line bg-panel md:sticky md:top-0 md:block md:h-screen md:w-60 md:shrink-0 md:border-r`}
      >
        <div className="flex h-full flex-col p-4">
          <Link href="/dashboard" className="mb-6 hidden items-center gap-2 px-2 font-semibold md:flex">
            <Logo /> Channel Toolkit
          </Link>
          <nav className="flex-1 space-y-0.5">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              if (item.soon)
                return (
                  <span key={item.href} className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-2 text-sm text-muted/70">
                    {item.label}
                    <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{item.soon}</span>
                  </span>
                );
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`block rounded-lg px-2.5 py-2 text-sm font-medium transition ${
                    active ? "bg-brand/10 text-brand" : "hover:bg-bg"
                  }`}
                >
                  <span className="flex items-center justify-between">
                    {item.label}
                    {item.href === "/inbox" && inboxOpen > 0 && (
                      <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold leading-none text-brand-ink tabular-nums">
                        {inboxOpen > 99 ? "99+" : inboxOpen}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </nav>
          <div className="mt-4 border-t border-line pt-4">
            <p className="truncate px-2 text-sm font-medium">{user.name}</p>
            <p className="truncate px-2 text-xs text-muted">{user.email}</p>
            <form action={logout} className="mt-3">
              <button className="btn-ghost w-full">Log out</button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
