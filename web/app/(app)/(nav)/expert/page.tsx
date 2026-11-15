"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { Button, Empty } from "@/components/ui";
import { api } from "@/lib/api";
import { since, useNow } from "@/lib/format";
import type { Session, Stats } from "@/lib/types";

export default function ExpertHome() {
  const { me, queue, available, setAvailable, accept } = useApp();
  const now = useNow();
  const [stats, setStats] = useState<Stats | null>(null);
  const [ongoing, setOngoing] = useState<Session[]>([]);

  useEffect(() => {
    api<Stats>("/stats").then(setStats, () => {});
    api<Session[]>("/sessions?status=active").then((list) => setOngoing(list.filter((s) => s.expert?.id === me.id)), () => {});
  }, [me.id, queue.length]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      {ongoing.map((s) => (
        <div key={s.id} className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue bg-card p-4">
          <p>You are still in a call with <strong>{s.technician.name}</strong>.</p>
          <Link href={`/expert/session/${s.id}`} className="rounded-md bg-blue px-4 py-2 font-bold text-white">Return to call</Link>
        </div>
      ))}

      <h1 className="text-2xl font-bold">Calls</h1>
      <section className="mt-4" aria-label="Waiting calls">
        {!available ? (
          <Empty title="You are not taking calls">
            <Button variant="primary" className="mt-3" onClick={() => setAvailable(true)}>Start taking calls</Button>
          </Empty>
        ) : queue.length === 0 ? (
          <Empty title="No one is waiting">You will hear a ring when a technician calls. Keep this tab open.</Empty>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {queue.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold">{s.technician.name}</p>
                  <p className="text-ink-soft">{[s.aircraft || "No aircraft given", s.checklist?.name].filter(Boolean).join(", ")}</p>
                </div>
                <p className="font-mono text-sm text-ink-soft">waiting {Math.round(since(s.createdAt, now))} s</p>
                <Button variant="go" size="lg" onClick={() => accept(s)}>Accept</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="week">
        <h2 id="week" className="font-bold">Last 7 days</h2>
        <p className="text-sm text-ink-soft">Counted from saved sessions.</p>
        {stats && (
          <dl className="mt-3 grid grid-cols-2 border-t border-rule sm:grid-cols-3">
            {[
              ["Calls", stats.calls],
              ["Answered", stats.answered],
              ["Not answered", stats.missed],
              ["Average call", stats.averageMinutes === null ? "–" : `${stats.averageMinutes} min`],
              ["Average wait", stats.averageWaitSeconds === null ? "–" : `${stats.averageWaitSeconds} s`],
              ["Checklists signed off", stats.signedOff],
            ].map(([label, value]) => (
              <div key={label} className="border-b border-rule py-3 pr-4">
                <dt className="text-sm text-ink-soft">{label}</dt>
                <dd className="font-mono text-2xl">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </main>
  );
}
