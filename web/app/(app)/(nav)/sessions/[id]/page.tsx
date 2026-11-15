"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui";
import { Media, Stamp } from "@/components/work";
import { api } from "@/lib/api";
import { dateTime, day, minutes, STATUS_LABEL, time } from "@/lib/format";
import type { SessionDetail } from "@/lib/types";

/** The session report: reads like a maintenance task card and prints on paper. */
export default function SessionReport() {
  const { id } = useParams<{ id: string }>();
  const { me } = useApp();
  const [s, setS] = useState<SessionDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<SessionDetail>(`/sessions/${id}`).then(setS, (e) => setError(e.message));
  }, [id]);

  if (error) return <main className="mx-auto max-w-4xl px-4 py-8"><p role="alert" className="font-bold text-warn">{error}</p></main>;
  if (!s) return <p className="p-8 text-ink-soft" role="status">Loading report…</p>;

  const results = Object.fromEntries(s.steps.map((r) => [r.step, r]));
  const notes = s.events.filter((e) => e.kind === "note" || e.kind === "chat");
  const inCall = s.status === "active" && (s.technician.id === me.id || s.expert?.id === me.id);
  const timeline = [
    { at: s.createdAt, text: `${s.technician.name} called for help` },
    ...(s.startedAt ? [{ at: s.startedAt, text: `${s.expert?.name ?? "An expert"} answered` }] : []),
    ...s.steps.map((r) => ({ at: r.at, text: `Step ${r.step + 1} marked ${r.status === "done" ? "done" : "as a problem"} by ${r.user.name}` })),
    ...s.events.map((e) => ({ at: e.at, text: `${e.user?.name ?? "Someone"} added a ${e.kind === "chat" ? "message" : e.kind}` })),
    ...(s.signedOff ? [{ at: s.signedOff.at, text: `${s.signedOff.by} signed off the checklist` }] : []),
    ...(s.endedAt ? [{ at: s.endedAt, text: "Call ended" }] : []),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 print:max-w-none print:p-0">
      <div className="no-print mb-6 flex flex-wrap gap-3">
        <Link href="/sessions" className="rounded-md border border-rule px-4 py-2 text-sm font-bold">All sessions</Link>
        <Button onClick={() => window.print()}>Print or save as PDF</Button>
        {inCall && (
          <Link href={me.role === "technician" ? `/tech/session/${s.id}` : `/expert/session/${s.id}`} className="rounded-md bg-blue px-4 py-2 text-sm font-bold text-white">
            Return to call
          </Link>
        )}
      </div>

      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-ink pb-3">
        <h1 className="text-2xl font-bold">Session report</h1>
        <p className="font-mono text-lg">{s.code}</p>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 border-b border-rule py-4 sm:grid-cols-4">
        {[
          ["Aircraft", s.aircraft || "–"],
          ["Date", day(s.createdAt)],
          ["Length", minutes(s.startedAt, s.endedAt)],
          ["Status", STATUS_LABEL[s.status]],
          ["Technician", s.technician.name],
          ["Expert", s.expert?.name ?? "–"],
          ["Drawings", String(s.annotationCount)],
          ["Answered", s.startedAt ? time(s.startedAt) : "–"],
        ].map(([label, value]) => (
          <div key={label} className="py-2">
            <dt className="text-sm text-ink-soft">{label}</dt>
            <dd className={label === "Aircraft" ? "font-mono font-bold" : "font-bold"}>{value}</dd>
          </div>
        ))}
      </dl>

      {s.checklist && (
        <section className="border-b border-rule py-6" aria-labelledby="checklist">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <h2 id="checklist" className="text-lg font-bold">{s.checklist.name}</h2>
            {s.signedOff ? <Stamp signedOff={s.signedOff} /> : <p className="font-bold text-ink-soft">Not signed off</p>}
          </div>
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-ink-soft">
              <tr className="border-b border-rule">
                <th scope="col" className="w-10 py-2">#</th>
                <th scope="col" className="py-2">Step</th>
                <th scope="col" className="py-2">Result</th>
                <th scope="col" className="py-2">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {s.checklist.steps.map((step, i) => {
                const r = results[i];
                return (
                  <tr key={i} className="align-top">
                    <td className="py-2 font-mono">{i + 1}</td>
                    <td className="py-2">
                      {step.text}
                      {step.critical && <span className="ml-2 text-xs font-bold">(critical)</span>}
                      {r?.note && <p className="mt-1 text-warn">“{r.note}”</p>}
                    </td>
                    <td className={`py-2 font-bold ${r?.status === "problem" ? "text-warn" : ""}`}>{r ? (r.status === "done" ? "Done" : "Problem") : "No result"}</td>
                    <td className="py-2">{r ? `${r.user.name}, ${time(r.at)}` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="border-b border-rule py-6" aria-labelledby="photos">
        <h2 id="photos" className="mb-3 text-lg font-bold">Photos and recordings</h2>
        <Media events={s.events} />
      </section>

      <section className="border-b border-rule py-6" aria-labelledby="notes">
        <h2 id="notes" className="mb-3 text-lg font-bold">Notes and messages</h2>
        {notes.length === 0 ? (
          <p className="text-ink-soft">None.</p>
        ) : (
          <ul className="space-y-3">
            {notes.map((e) => (
              <li key={e.id}>
                <p className="text-sm text-ink-soft">{e.kind === "note" ? "Note" : "Message"} from {e.user?.name}, {time(e.at)}</p>
                <p>{e.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="py-6" aria-labelledby="timeline">
        <h2 id="timeline" className="mb-3 text-lg font-bold">Timeline</h2>
        <ol className="space-y-1 text-sm">
          {timeline.map((t, i) => (
            <li key={i} className="grid grid-cols-[5rem_1fr] gap-3">
              <span className="font-mono text-ink-soft">{time(t.at)}</span>
              <span>{t.text}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-xs text-ink-soft">Printed from ArGuide. Times are local to this device. Report made {dateTime(new Date().toISOString())}.</p>
      </section>
    </main>
  );
}
