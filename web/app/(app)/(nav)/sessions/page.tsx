"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Empty, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { day, minutes, STATUS_LABEL, time } from "@/lib/format";
import type { Session, SessionStatus } from "@/lib/types";

export default function SessionsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [days, setDays] = useState("30");
  const [rows, setRows] = useState<Session[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q, status, days });
      api<Session[]>(`/sessions?${params}`).then((r) => { setRows(r); setError(""); }, (e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, status, days]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">Sessions</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sessions" placeholder="Search by aircraft, name, checklist or SES number" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {(["ended", "active", "missed", "cancelled"] as SessionStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="0">All time</option>
        </Select>
      </div>

      {error && <p role="alert" className="mt-6 font-bold text-warn">{error}</p>}
      {rows === null ? (
        <p className="mt-6 text-ink-soft" role="status">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="mt-6"><Empty title="No sessions match">Clear the search or choose a longer period.</Empty></div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-rule bg-card">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-rule text-ink-soft">
              <tr>
                {["Session", "Date", "Aircraft", "Checklist", "Technician", "Expert", "Length", "Status"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-paper">
                  <td className="px-4 py-3 font-mono">
                    <Link href={`/sessions/${s.id}`} className="font-bold text-blue underline-offset-2 hover:underline">{s.code}</Link>
                  </td>
                  <td className="px-4 py-3">{day(s.createdAt)}, {time(s.createdAt)}</td>
                  <td className="px-4 py-3 font-mono">{s.aircraft || "–"}</td>
                  <td className="px-4 py-3">{s.checklist?.name ?? "–"}{s.signedOff && <span className="ml-2 font-bold text-blue">Signed off</span>}</td>
                  <td className="px-4 py-3">{s.technician.name}</td>
                  <td className="px-4 py-3">{s.expert?.name ?? "–"}</td>
                  <td className="px-4 py-3 font-mono">{minutes(s.startedAt, s.endedAt)}</td>
                  <td className="px-4 py-3">{STATUS_LABEL[s.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
