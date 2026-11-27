"use client";

import {
  BadgeCheck, ChevronRight, CircleCheck, ClipboardCheck, Clock, History, PhoneCall, PhoneMissed, Timer, UserPlus, Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { SessionList } from "@/components/sessions";
import { Avatar, Button, Empty, Mark } from "@/components/ui";
import { api } from "@/lib/api";
import { since, today, useNow } from "@/lib/format";
import type { Checklist, Session, Stats, User } from "@/lib/types";

export default function ExpertHome() {
  const { me, queue, available, setAvailable, accept } = useApp();
  const now = useNow();
  const admin = me.role === "admin";
  const [stats, setStats] = useState<Stats | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [checklists, setChecklists] = useState<Checklist[] | null>(null);
  const [people, setPeople] = useState<User[] | null>(null);

  useEffect(() => {
    api<Stats>("/stats").then(setStats, () => {});
    api<Session[]>("/sessions").then(setSessions, () => setSessions([]));
  }, [queue.length]);
  useEffect(() => {
    api<Checklist[]>("/checklists").then(setChecklists, () => {});
    if (admin) api<User[]>("/users").then(setPeople, () => {});
  }, [admin]);

  const ongoing = (sessions ?? []).filter((s) => s.status === "active" && s.expert?.id === me.id);
  const needsTechnician = people !== null && !people.some((p) => p.active && p.role === "technician");
  const shortcuts = [
    { href: "/sessions", icon: History, label: "Sessions", text: "Reports, photos and recordings" },
    { href: "/checklists", icon: ClipboardCheck, label: "Checklists", text: checklists ? `${checklists.length} ready to use` : "Steps for each job" },
    ...(admin ? [{ href: "/admin/users", icon: Users, label: "People", text: people ? `${people.filter((p) => p.active).length} with access` : "Who can use ArGuide" }] : []),
  ];

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <header>
        <h1 className="wrap-anywhere text-3xl font-bold tracking-tight">Hello, {me.name}</h1>
        <p className="mt-1 text-ink-soft">{today(now)}</p>
      </header>

      {ongoing.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-blue bg-card p-4">
          <p>You are still in a call with <strong>{s.technician.name}</strong>.</p>
          <Link href={`/expert/session/${s.id}`} className="grid min-h-10 place-items-center rounded-md bg-blue px-4 font-bold text-white">Return to call</Link>
        </div>
      ))}

      {/* The live board: dark like the call screens, because this is what is happening now. */}
      <section className="live overflow-hidden rounded-2xl" aria-labelledby="waiting">
        <div className="flex items-center gap-4 border-b border-panel-line px-5 py-4">
          <span className={`rounded-lg ${queue.length && available ? "motion-safe:animate-ring" : ""}`}>
            <Mark className="size-10" />
          </span>
          <h2 id="waiting" className="flex-1 text-lg font-bold">Waiting calls</h2>
          {queue.length > 0 && available && <span className="rounded-full bg-caution px-3 py-1 text-sm font-bold text-ink">{queue.length}</span>}
        </div>
        {!available ? (
          <div className="px-6 py-10 text-center">
            <p className="text-xl font-bold">You are not taking calls</p>
            <p className="mt-2 text-dim">Technicians cannot ring you until you switch this on.</p>
            <Button variant="primary" size="lg" className="mt-5" onClick={() => setAvailable(true)}>Start taking calls</Button>
          </div>
        ) : queue.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-xl font-bold">No one is waiting</p>
            <p className="mt-2 text-dim">You will hear a ring when a technician calls. Keep this tab open.</p>
          </div>
        ) : (
          <ul className="divide-y divide-panel-line">
            {queue.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Avatar name={s.technician.name} dark className="size-12" />
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold">{s.technician.name}</p>
                  <p className="text-dim">{[s.aircraft || "No aircraft given", s.checklist?.name].filter(Boolean).join(", ")}</p>
                </div>
                <p className="flex items-center gap-2 text-sm tabular-nums text-dim">
                  <Clock aria-hidden className="size-4" />
                  waiting {Math.round(since(s.createdAt, now))} s
                </p>
                <Button variant="go" size="lg" onClick={() => accept(s)}>Accept</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {needsTechnician && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-blue bg-blue/5 p-5">
          <UserPlus aria-hidden className="size-8 text-blue" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Add a technician so calls can start</p>
            <p className="text-sm text-ink-soft">Technicians call you from their phone.</p>
          </div>
          <Link href="/admin/users" className="grid min-h-10 place-items-center rounded-md bg-blue px-4 font-bold text-white">Add people</Link>
        </div>
      )}

      <nav aria-label="Shortcuts">
        <ul className={`grid gap-3 ${admin ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {shortcuts.map(({ href, icon: Icon, label, text }) => (
            <li key={href}>
              <Link href={href} className="flex h-full items-center gap-4 rounded-xl border border-rule bg-card p-4 transition-colors hover:border-blue">
                <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-blue text-white">
                  <Icon aria-hidden className="size-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{label}</span>
                  <span className="block text-sm text-ink-soft">{text}</span>
                </span>
                <ChevronRight aria-hidden className="size-5 text-ink-soft" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="week">
        <h2 id="week" className="text-lg font-bold">Last 7 days</h2>
        {stats && (
          <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-3">
            {([
              ["Calls", stats.calls, PhoneCall, "text-blue"],
              ["Answered", stats.answered, CircleCheck, "text-normal-ink"],
              ["Not answered", stats.missed, PhoneMissed, stats.missed ? "text-warn" : "text-ink-soft"],
              ["Average call", stats.averageMinutes === null ? "–" : `${stats.averageMinutes} min`, Timer, "text-blue"],
              ["Average wait", stats.averageWaitSeconds === null ? "–" : `${stats.averageWaitSeconds} s`, Clock, "text-blue"],
              ["Checklists signed off", stats.signedOff, BadgeCheck, "text-blue"],
            ] as const).map(([label, value, Icon, colour]) => (
              <div key={label} className="bg-card p-4">
                <dt className="flex items-center gap-2 text-sm text-ink-soft">
                  <Icon aria-hidden className={`size-4 ${colour}`} />
                  {label}
                </dt>
                <dd className="mt-1 text-3xl font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby="recent">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="recent" className="text-lg font-bold">Recent calls</h2>
          <Link href="/sessions" className="rounded-md px-2 py-1 text-sm font-bold text-blue hover:underline">All sessions</Link>
        </div>
        {sessions === null ? (
          <p className="text-ink-soft" role="status">Loading…</p>
        ) : sessions.length === 0 ? (
          <Empty title="No calls yet" icon={History}>Finished calls appear here with their reports.</Empty>
        ) : (
          <SessionList sessions={sessions.slice(0, 5)} meId={me.id} />
        )}
      </section>
    </main>
  );
}
