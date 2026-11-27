"use client";

import { useEffect, useRef, useState } from "react";
import type { Call } from "@/components/call/use-call";
import { fileUrl } from "@/lib/api";
import { dateTime, time } from "@/lib/format";
import type { SessionEvent, SignOff } from "@/lib/types";
import { Button } from "./ui";

/** The inspector's stamp: the one bold element. Appears when the expert signs the checklist off. */
export function Stamp({ signedOff, dark }: { signedOff: SignOff; dark?: boolean }) {
  return (
    <div
      className={`inline-block animate-stamp rounded-lg border-[3px] p-1 font-mono ${dark ? "border-blue-bright text-blue-bright" : "border-blue text-blue"}`}
    >
      <div className="rounded-md border border-current px-4 py-2 text-center">
        <p className="text-lg font-bold tracking-widest">SIGNED OFF</p>
        <p className="text-sm">{signedOff.by}</p>
        <p className="text-xs">{dateTime(signedOff.at)}</p>
      </div>
    </div>
  );
}

const DARK_INPUT = "min-h-10 w-full rounded-md border border-panel-line bg-hangar px-3 text-white placeholder:text-dim";

function ProblemForm({ onSave, onCancel, big }: { onSave: (note: string) => void; onCancel: () => void; big?: boolean }) {
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(String(new FormData(e.currentTarget).get("note") ?? ""));
      }}
    >
      <input name="note" autoFocus required aria-label="What is wrong?" placeholder="What is wrong?" className={DARK_INPUT} />
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size={big ? "lg" : "md"} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size={big ? "lg" : "md"} variant="danger">
          Save problem
        </Button>
      </div>
    </form>
  );
}

/** Expert: every step, with results, and the sign-off. */
export function ChecklistPanel({ call }: { call: Call }) {
  const [noting, setNoting] = useState<number | null>(null);
  const checklist = call.session?.checklist;
  if (!checklist?.steps.length) return <p className="text-dim">No checklist was chosen for this call.</p>;
  const results = Object.keys(call.steps).length;
  const locked = !!call.signedOff;
  return (
    <div className="space-y-4">
      <div>
        <p className="font-bold">{checklist.name}</p>
        <p className="text-sm text-dim">
          {results} of {checklist.steps.length} steps have a result
        </p>
      </div>
      <ol className="space-y-2">
        {checklist.steps.map((step, i) => {
          const r = call.steps[i];
          return (
            <li key={i} className="rounded-md border border-panel-line p-3">
              <div className="flex gap-3">
                <span className="font-mono text-dim">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p>{step.text}</p>
                  {step.critical && <p className="text-xs font-bold text-caution">Critical step</p>}
                  {r && (
                    <p className={`mt-1 text-sm font-bold ${r.status === "done" ? "text-normal-bright" : "text-warn-bright"}`}>
                      {r.status === "done" ? "Done" : "Problem"}, {r.user.name}, {time(r.at)}
                      {r.note && <span className="block font-normal text-white">{r.note}</span>}
                    </p>
                  )}
                </div>
              </div>
              {!locked && noting !== i && (
                <div className="mt-2 flex flex-wrap gap-2 pl-7">
                  <Button onClick={() => call.setStep(i, "done")} disabled={r?.status === "done"}>
                    Done
                  </Button>
                  <Button onClick={() => setNoting(i)}>Problem</Button>
                  {r && <Button onClick={() => call.setStep(i, null)}>Clear</Button>}
                </div>
              )}
              {noting === i && (
                <ProblemForm onCancel={() => setNoting(null)} onSave={(note) => call.setStep(i, "problem", note).then(() => setNoting(null))} />
              )}
            </li>
          );
        })}
      </ol>
      {call.signedOff ? (
        <Stamp signedOff={call.signedOff} dark />
      ) : (
        <div>
          <Button variant="primary" className="w-full" disabled={results < checklist.steps.length} onClick={call.signOff}>
            Sign off checklist
          </Button>
          {results < checklist.steps.length && <p className="mt-2 text-sm text-dim">Every step needs a result first.</p>}
        </div>
      )}
    </div>
  );
}

/** Technician: one step at a time, with big buttons. */
export function StepCard({ call, onHide }: { call: Call; onHide: () => void }) {
  const [noting, setNoting] = useState(false);
  const steps = call.session?.checklist?.steps ?? [];
  const current = steps.findIndex((_, i) => !call.steps[i]);
  const hide = (
    <button onClick={onHide} className="rounded-md px-2 py-1 text-sm text-dim underline">
      Hide
    </button>
  );
  if (current === -1) {
    return (
      <div className="rounded-xl bg-panel/95 p-4 text-center">
        {call.signedOff ? (
          <Stamp signedOff={call.signedOff} dark />
        ) : (
          <p>All {steps.length} steps have a result. The expert will sign off.</p>
        )}
        <div className="mt-2">{hide}</div>
      </div>
    );
  }
  const step = steps[current];
  return (
    <section aria-label="Current step" className="rounded-xl bg-panel/95 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-dim">
          Step {current + 1} of {steps.length}
          {step.critical && <span className="ml-2 font-bold text-caution">Critical</span>}
        </p>
        {hide}
      </div>
      <p className="mt-1 text-lg font-bold">{step.text}</p>
      {noting ? (
        <ProblemForm big onCancel={() => setNoting(false)} onSave={(note) => call.setStep(current, "problem", note).then(() => setNoting(false))} />
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button size="lg" onClick={() => setNoting(true)}>
            Problem
          </Button>
          <Button size="lg" variant="go" onClick={() => call.setStep(current, "done")}>
            Done
          </Button>
        </div>
      )}
    </section>
  );
}

/** Chat (both sides see it) or notes (for the report). */
export function Messages({ call, kind }: { call: Call; kind: "chat" | "note" }) {
  const list = call.events.filter((e) => e.kind === kind);
  const [text, setText] = useState("");
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" }); // newer browsers return a Promise here; React must not get it
  }, [list.length]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto" aria-live="polite">
        {list.length === 0 && (
          <li className="text-dim">{kind === "chat" ? "No messages yet. Type here when it is too loud to talk." : "Notes are saved to the session report."}</li>
        )}
        {list.map((e) => (
          <li key={e.id}>
            <p className="text-xs text-dim">
              {e.user?.id === call.me.id ? "You" : e.user?.name}, {time(e.at)}
            </p>
            <p className="break-words">{e.text}</p>
          </li>
        ))}
        <li ref={end} aria-hidden />
      </ol>
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (text.trim() && (await call.send(kind, text))) setText("");
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          aria-label={kind === "chat" ? "Message" : "Note"}
          placeholder={kind === "chat" ? "Message" : "Add a note"}
          className={DARK_INPUT}
        />
        <Button type="submit" variant="primary">
          {kind === "chat" ? "Send" : "Save"}
        </Button>
      </form>
    </div>
  );
}

export function Media({ events, dark }: { events: SessionEvent[]; dark?: boolean }) {
  const photos = events.filter((e) => e.kind === "photo");
  const recordings = events.filter((e) => e.kind === "recording");
  if (!photos.length && !recordings.length) {
    return <p className={dark ? "text-dim" : "text-ink-soft"}>No photos yet. Use Photo to save the picture with its drawings.</p>;
  }
  return (
    <div className="space-y-4">
      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {photos.map((e) => (
            <li key={e.id}>
              <a href={fileUrl(e.id)} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(e.id)} alt={`Photo by ${e.user?.name ?? "unknown"}, ${time(e.at)}`} className="aspect-video w-full rounded-md bg-black object-cover" loading="lazy" />
              </a>
              <p className={`mt-1 text-xs ${dark ? "text-dim" : "text-ink-soft"}`}>
                {e.user?.name}, {time(e.at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {recordings.map((e) => (
        <figure key={e.id} className="max-w-md">
          <video src={fileUrl(e.id)} controls preload="metadata" className="aspect-video w-full rounded-md bg-black" />
          <figcaption className={`mt-1 text-xs ${dark ? "text-dim" : "text-ink-soft"}`}>Recording, saved {time(e.at)}</figcaption>
        </figure>
      ))}
    </div>
  );
}
