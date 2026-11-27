"use client";

import { ArrowLeftRight, ClipboardCheck, History, House, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { choosePerson, homeFor } from "@/lib/api";
import { isExpert, useApp } from "./app-provider";
import { Avatar, Mark } from "./ui";

/** The sections this person can open, used by the top bar and the phone's bottom tabs. */
function useSections() {
  const { me, queue } = useApp();
  const pathname = usePathname();
  const home = homeFor(me.role);
  return [
    { href: home, label: "Home", icon: House, badge: isExpert(me) ? queue.length : 0 },
    { href: "/sessions", label: "Sessions", icon: History, badge: 0 },
    ...(isExpert(me) ? [{ href: "/checklists", label: "Checklists", icon: ClipboardCheck, badge: 0 }] : []),
    ...(me.role === "admin" ? [{ href: "/admin/users", label: "People", icon: Users, badge: 0 }] : []),
  ].map((s) => ({
    ...s,
    // "/expert/session/…" is the live call, not the Home page, but Home is still where you came from.
    current: pathname === s.href || pathname.startsWith(`${s.href}/`),
  }));
}

const inCall = (pathname: string) => pathname.startsWith("/expert/session/");

const Badge = ({ n }: { n: number }) =>
  n ? (
    <span className="grid min-w-5 place-items-center rounded-full bg-caution px-1 text-xs font-bold text-ink">
      {n}
      <span className="sr-only"> waiting</span>
    </span>
  ) : null;

export function TopNav() {
  const { me, online, available, setAvailable } = useApp();
  const pathname = usePathname();
  const sections = useSections();

  const switchPerson = () => {
    choosePerson(null);
    window.location.assign("/login");
  };

  return (
    <header className="live no-print border-b border-panel-line">
      <nav aria-label="Main" className="mx-auto flex min-h-14 max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <Mark />
          ArGuide
        </Link>
        {/* On phones these move to the bottom tabs; the expert's call screen has no tabs, so it keeps them here. */}
        <ul className={`flex-wrap gap-1 ${inCall(pathname) ? "flex" : "hidden sm:flex"}`}>
          {sections.map(({ href, label, icon: Icon, badge, current }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-10 items-center gap-2 rounded-md px-3 text-sm transition-colors ${current ? "bg-panel font-bold text-white" : "text-dim hover:bg-panel/60 hover:text-white"}`}
              >
                <Icon aria-hidden className="size-4" />
                {label}
                <Badge n={badge} />
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-3">
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
              <span className="sr-only lg:not-sr-only">{available ? "Available" : "Not taking calls"}</span>
            </label>
          )}
          <span className="flex items-center gap-2">
            <Avatar name={me.name} dark className="size-8 text-xs" />
            <span className="hidden text-sm text-dim md:inline">{me.name}</span>
          </span>
          <button onClick={switchPerson} className="flex min-h-10 items-center gap-2 rounded-md px-2 text-sm text-dim hover:bg-panel/60 hover:text-white">
            <ArrowLeftRight aria-hidden className="size-4" />
            <span className="sr-only lg:not-sr-only">Switch person</span>
          </button>
        </div>
      </nav>
    </header>
  );
}

/** Phones: the sections as large tabs at the bottom, in thumb's reach. */
export function TabBar() {
  const pathname = usePathname();
  const sections = useSections();
  if (inCall(pathname)) return null;
  return (
    <div className="no-print sm:hidden">
      <div aria-hidden className="h-20" /> {/* keeps the end of the page clear of the tabs */}
      <nav aria-label="Sections" className="live fixed inset-x-0 bottom-0 z-40 flex border-t border-panel-line pb-[env(safe-area-inset-bottom)]">
        {sections.map(({ href, label, icon: Icon, badge, current }) => (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-bold ${current ? "bg-panel text-white" : "text-dim"}`}
          >
            <span className="flex items-center gap-1">
              <Icon aria-hidden className="size-6" />
              <Badge n={badge} />
            </span>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
