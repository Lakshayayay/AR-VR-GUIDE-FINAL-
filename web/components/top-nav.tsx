"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { choosePerson } from "@/lib/api";
import { isExpert, useApp } from "./app-provider";

export function TopNav() {
  const { me, online, queue, available, setAvailable } = useApp();
  const pathname = usePathname();
  const links = [
    ...(me.role === "technician" ? [{ href: "/tech", label: "Home" }] : [{ href: "/expert", label: queue.length ? `Calls (${queue.length})` : "Calls" }]),
    { href: "/sessions", label: "Sessions" },
    ...(isExpert(me) ? [{ href: "/checklists", label: "Checklists" }] : []),
    ...(me.role === "admin" ? [{ href: "/admin/users", label: "People" }] : []),
  ];

  const switchPerson = () => {
    choosePerson(null);
    window.location.assign("/login");
  };

  return (
    <header className="live no-print border-b border-panel-line">
      <nav aria-label="Main" className="mx-auto flex min-h-14 max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
        <Link href="/" className="text-lg font-bold tracking-tight">
          ArGuide
        </Link>
        <ul className="flex flex-wrap gap-1">
          {links.map((l) => {
            const current = pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={current ? "page" : undefined}
                  className={`block rounded-md px-3 py-2 text-sm ${current ? "bg-panel font-bold text-white" : "text-dim hover:text-white"}`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="ml-auto flex items-center gap-4">
          {!online && (
            <span role="status" className="rounded-md bg-caution px-2 py-1 text-xs font-bold text-ink">
              Offline. Reconnecting…
            </span>
          )}
          {isExpert(me) && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                checked={available}
                onChange={(e) => setAvailable(e.target.checked)}
                className="peer sr-only"
              />
              <span aria-hidden className="relative h-6 w-11 rounded-full bg-panel-line transition-colors peer-checked:bg-normal peer-focus-visible:outline-3 peer-focus-visible:outline-blue-bright after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
              {available ? "Available" : "Not taking calls"}
            </label>
          )}
          <span className="hidden text-sm text-dim sm:inline">{me.name}</span>
          <button onClick={switchPerson} className="rounded-md px-2 py-2 text-sm text-dim hover:text-white">
            Switch person
          </button>
        </div>
      </nav>
    </header>
  );
}
