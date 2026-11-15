"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { Button, Empty, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { day, minutes, STATUS_LABEL } from "@/lib/format";
import type { Checklist, Session } from "@/lib/types";

export default function TechnicianHome() {
  const { socket, toast, me } = useApp();
  const router = useRouter();
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [recent, setRecent] = useState<Session[] | null>(null);
  const [aircraft, setAircraft] = useState("");
  const [checklistId, setChecklistId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Checklist[]>("/checklists").then(setChecklists, () => {});
    api<Session[]>("/sessions").then(setRecent, () => setRecent([]));
  }, []);

  const knownAircraft = [...new Set((recent ?? []).map((s) => s.aircraft).filter(Boolean))];

  const startCall = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await socket.timeout(8000).emitWithAck("call:start", { aircraft, checklistId: checklistId ? Number(checklistId) : null });
      if (r.ok) return router.push(`/tech/session/${r.session.id}`);
      toast(r.error);
    } catch {
      toast("No reply from the server. Check your connection and try again.");
    }
    setBusy(false);
  };

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-2xl font-bold">Hello, {me.name.split(" ")[0]}</h1>
      <form onSubmit={startCall} className="mt-6 space-y-5">
        <Field label="Aircraft" hint="Registration or tail number, if you have it.">
          <Input
            value={aircraft}
            onChange={(e) => setAircraft(e.target.value.toUpperCase())}
            list="aircraft-list"
            placeholder="VT-ABC"
            maxLength={32}
            autoCapitalize="characters"
            className="min-h-14 font-mono text-lg"
          />
          <datalist id="aircraft-list">
            {knownAircraft.map((a) => <option key={a} value={a} />)}
          </datalist>
        </Field>
        <Field label="Checklist">
          <Select value={checklistId} onChange={(e) => setChecklistId(e.target.value)} className="min-h-14">
            <option value="">No checklist</option>
            {checklists.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Button type="submit" variant="primary" size="lg" className="min-h-16 w-full text-lg" disabled={busy}>
          {busy ? "Calling…" : "Call an expert"}
        </Button>
      </form>

      <section className="mt-12" aria-labelledby="recent">
        <h2 id="recent" className="font-bold">Your recent sessions</h2>
        {recent === null ? (
          <p className="mt-3 text-ink-soft" role="status">Loading…</p>
        ) : recent.length === 0 ? (
          <div className="mt-3"><Empty title="No sessions yet">Your calls will be listed here with their reports.</Empty></div>
        ) : (
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {recent.slice(0, 6).map((s) => (
              <li key={s.id}>
                <Link href={`/sessions/${s.id}`} className="grid grid-cols-[auto_1fr_auto] gap-x-4 py-3 hover:bg-card">
                  <span className="font-mono text-sm text-ink-soft">{day(s.createdAt)}</span>
                  <span className="truncate">{s.checklist?.name ?? (s.aircraft || "Call")}</span>
                  <span className="text-sm text-ink-soft">{s.status === "ended" ? minutes(s.startedAt, s.endedAt) : STATUS_LABEL[s.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
