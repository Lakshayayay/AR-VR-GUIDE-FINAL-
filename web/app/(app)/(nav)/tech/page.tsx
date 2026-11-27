"use client";

import { History, PhoneCall } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { SessionList } from "@/components/sessions";
import { Button, Empty, Field, Input, Mark, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { today, useNow } from "@/lib/format";
import type { Checklist, Session } from "@/lib/types";

export default function TechnicianHome() {
  const { socket, toast, me } = useApp();
  const router = useRouter();
  const now = useNow();
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
    <main className="mx-auto max-w-md space-y-8 px-4 py-6">
      <header>
        <h1 className="wrap-anywhere text-3xl font-bold tracking-tight">Hello, {me.name}</h1>
        <p className="mt-1 text-ink-soft">{today(now)}</p>
      </header>

      <form onSubmit={startCall} className="live space-y-5 rounded-2xl p-5" aria-labelledby="ask">
        <div className="flex items-center gap-3">
          <Mark className="size-10" />
          <h2 id="ask" className="text-lg font-bold">Get help on a job</h2>
        </div>
        <Field label="Aircraft">
          <Input
            value={aircraft}
            onChange={(e) => setAircraft(e.target.value.toUpperCase())}
            list="aircraft-list"
            placeholder="Registration or tail number"
            maxLength={32}
            autoCapitalize="characters"
            className="min-h-14 font-mono text-lg placeholder:font-sans placeholder:text-base"
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
          <PhoneCall aria-hidden className="size-6" />
          {busy ? "Calling…" : "Call an expert"}
        </Button>
      </form>

      <section aria-labelledby="recent">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="recent" className="text-lg font-bold">Your recent calls</h2>
          <Link href="/sessions" className="rounded-md px-2 py-1 text-sm font-bold text-blue hover:underline">All sessions</Link>
        </div>
        {recent === null ? (
          <p className="text-ink-soft" role="status">Loading…</p>
        ) : recent.length === 0 ? (
          <Empty title="No calls yet" icon={History}>Your calls will be listed here with their reports.</Empty>
        ) : (
          <SessionList sessions={recent.slice(0, 5)} meId={me.id} />
        )}
      </section>
    </main>
  );
}
