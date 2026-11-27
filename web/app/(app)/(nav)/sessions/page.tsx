"use client";

import { History } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { SessionList, SignedPill, StatusPill } from "@/components/sessions";
import { Avatar, Empty, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, minutes, STATUS_LABEL } from "@/lib/format";
import type { Session, SessionStatus } from "@/lib/types";

export default function SessionsPage() {
  const { me } = useApp();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [days, setDays] = useState("30");
  const [rows, setRows] = useState<Session[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q, status, days });
      api<Session[]>(`/sessions?${params}`).then((r) => {
        if (stale) return;
        setRows(r);
        setError("");
      }, (e) => {
        if (!stale) setError(e.message);
      });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, status, days]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">Sessions</h1>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sessions" placeholder="Aircraft, person, checklist or session code" className="col-span-2 sm:col-span-1" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {(["ended", "active", "waiting", "missed", "cancelled"] as const satisfies readonly SessionStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="0">All time</option>
        </Select>
      </div>

      {error ? <p role="alert" className="mt-6 font-bold text-warn">{error}</p> : rows === null ? (
        <p className="mt-6 text-ink-soft" role="status">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="mt-6">
          {q || status || days === "7" ? (
            <Empty icon={History} title="No sessions match">Try a different search or change the filters.</Empty>
          ) : (
            <Empty icon={History} title={days === "0" ? "No sessions yet" : "No recent sessions"}>
              {days === "0" ? "Your calls will appear here." : "New calls will appear here. Choose All time to see older calls."}
            </Empty>
          )}
        </div>
      ) : (
        <>
          <div className="mt-6 lg:hidden"><SessionList sessions={rows} meId={me.id} details /></div>
          <div className="mt-6 hidden overflow-hidden rounded-xl border border-rule bg-card lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-rule text-ink-soft">
                <tr>
                  {["Session", "Aircraft and checklist", "Technician", "Expert", "Length", "Status"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map((s) => (
                  <tr key={s.id} className="hover:bg-paper">
                    <td className="px-4 py-3">
                      <Link href={`/sessions/${s.id}`} className="font-mono font-bold text-blue underline-offset-2 hover:underline">{s.code}</Link>
                      <span className="block text-ink-soft tabular-nums">{dateTime(s.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3">
                      {s.aircraft && <p className="wrap-anywhere font-mono font-bold">{s.aircraft}</p>}
                      <p className="wrap-anywhere text-ink-soft">{s.checklist?.name ?? "No checklist"}</p>
                    </td>
                    {[s.technician, s.expert].map((person, i) => (
                      <td key={i} className="px-4 py-3">
                        {person ? (
                          <span className="flex items-center gap-2 wrap-anywhere">
                            <Avatar name={person.name} className="size-8 text-xs" />
                            {person.name}
                          </span>
                        ) : <span className="text-ink-soft">Unassigned</span>}
                      </td>
                    ))}
                    <td className="px-4 py-3 tabular-nums">{minutes(s.startedAt, s.endedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1.5">
                        <StatusPill status={s.status} />
                        {s.signedOff && <SignedPill />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
