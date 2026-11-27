"use client";

import {
  Camera, Circle, Disc, Eraser, Hand, MousePointer2, MoveUpRight, Pause, Pencil, Play, Square, Type, Undo2, Volume2, VolumeX, Mic, MicOff,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { SignalBars, Stage } from "@/components/call/stage";
import { useCall } from "@/components/call/use-call";
import { Button } from "@/components/ui";
import { ChecklistPanel, Media, Messages } from "@/components/work";
import { EXPERT_COLOURS, type Placements, type Tool } from "@/lib/annotations";
import { api } from "@/lib/api";
import { clock, since, useNow } from "@/lib/format";
import type { SessionDetail } from "@/lib/types";

export default function ExpertCallPage() {
  const { id } = useParams<{ id: string }>();
  const { me, accept } = useApp();
  const [session, setSession] = useState<SessionDetail | null | undefined>(undefined);

  useEffect(() => {
    api<SessionDetail>(`/sessions/${id}`).then(setSession, () => setSession(null));
  }, [id]);

  if (session === undefined) return <p className="p-8" role="status">Loading call…</p>;
  const mine = session && (session.expert?.id === me.id);

  // Opened from a link while the call is still ringing: answer it first.
  if (session?.status === "waiting") {
    return (
      <Notice title={`${session.technician.name} is calling`}>
        <p>{[session.aircraft, session.checklist?.name].filter(Boolean).join(", ") || "No details given"}</p>
        <Button
          variant="go"
          size="lg"
          className="mt-6"
          onClick={async () => (await accept(session)) && setSession({ ...session, status: "active", expert: { id: me.id, name: me.name } })}
        >
          Accept call
        </Button>
      </Notice>
    );
  }
  if (!session || !mine || session.status !== "active") {
    return (
      <Notice title={session?.status === "active" ? "Another expert has this call" : "This call is not live"}>
        <div className="mt-6 flex flex-wrap gap-3">
          {session && <Link className="rounded-md bg-blue px-4 py-2 font-bold text-white" href={`/sessions/${session.id}`}>Open the report</Link>}
          <Link className="rounded-md border border-current/30 px-4 py-2 font-bold" href="/expert">Back to calls</Link>
        </div>
      </Notice>
    );
  }
  return <Console sessionId={session.id} />;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-2 text-ink-soft">{children}</div>
    </main>
  );
}

const TOOLS: { id: Tool | "pointer"; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "pointer", label: "Pointer", icon: MousePointer2 },
  { id: "arrow", label: "Arrow", icon: MoveUpRight },
  { id: "circle", label: "Circle", icon: Circle },
  { id: "rect", label: "Box", icon: Square },
  { id: "pen", label: "Pen", icon: Pencil },
  { id: "text", label: "Text", icon: Type },
];

type Tab = "checklist" | "chat" | "notes" | "photos";

function Console({ sessionId }: { sessionId: number }) {
  const call = useCall(sessionId, "expert");
  const { queue, toast } = useApp();
  const now = useNow();
  const videoRef = useRef<HTMLVideoElement>(null);
  const placements = useRef<Placements>({});
  const [tool, setTool] = useState<Tool | "pointer" | null>("arrow");
  const [colour, setColour] = useState(EXPERT_COLOURS[0].value);
  const [micOn, setMicOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [tab, setTab] = useState<Tab>("checklist");
  const { phase, session } = call;
  const live = phase === "live" || phase === "connecting";

  useEffect(() => call.local?.getAudioTracks().forEach((t) => (t.enabled = micOn)), [micOn, call.local]);
  useEffect(() => {
    if (tool !== "pointer") call.sendPointer(null);
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        call.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [call]);

  const chatCount = call.events.filter((e) => e.kind === "chat").length;
  const photoCount = call.events.filter((e) => e.kind === "photo" || e.kind === "recording").length;
  const linkDown = phase === "live" && (!call.other || call.link === "disconnected" || call.link === "failed");
  const q = call.quality;

  return (
    <main className="live grid min-h-[calc(100dvh-3.5rem)] gap-px bg-panel-line lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[15rem_minmax(0,1fr)_22rem]">
      {/* Left: who is on the call */}
      <aside className="space-y-6 bg-hangar p-4">
        <section aria-label="This call">
          <p className="text-sm text-dim">In call with</p>
          <p className="text-xl font-bold">{session?.technician.name ?? "…"}</p>
          <p className={`mt-1 text-dim ${session?.aircraft ? "font-mono" : ""}`}>{session?.aircraft || "No aircraft given"}</p>
          <p className="font-mono text-sm text-dim">{session?.code}</p>
          <p className="mt-3 text-2xl tabular-nums">{live ? clock(since(session?.startedAt, now)) : "--:--"}</p>
          <Button variant="danger" className="mt-4 w-full" onClick={() => call.end()} disabled={!live}>
            End call
          </Button>
        </section>
        <section aria-label="Waiting calls">
          <p className="text-sm text-dim">Waiting ({queue.length})</p>
          <ul className="mt-2 space-y-2">
            {queue.map((s) => (
              <li key={s.id} className="rounded-md border border-panel-line p-2 text-sm">
                <p className="font-bold">{s.technician.name}</p>
                <p className={`text-dim ${s.aircraft ? "font-mono" : ""}`}>{s.aircraft || "No aircraft"}</p>
              </li>
            ))}
          </ul>
          {queue.length > 0 && <p className="mt-2 text-xs text-dim">End this call to answer the next one.</p>}
        </section>
      </aside>

      {/* Centre: video and tools */}
      <section className="flex min-h-[60dvh] flex-col bg-hangar">
        <div className="relative min-h-0 flex-1">
          <Stage
            videoRef={videoRef}
            stream={call.remote}
            muted={!speakerOn}
            frozen={call.frozen}
            shapes={call.shapes}
            pointer={call.pointer}
            tool={live ? tool : null}
            colour={colour}
            author={call.me.id}
            onPut={call.putShape}
            onPointer={call.sendPointer}
            placementsRef={placements}
            evidenceRef={call.evidenceRef}
            onWeakAnchor={() => toast("Not enough detail here to hold the drawing. Freeze the picture, or draw near an edge or a label.")}
            label={`Camera of ${session?.technician.name ?? "the technician"}`}
          >
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2" aria-live="polite">
              <div className="space-y-2">
                {call.frozen && <p className="rounded-md bg-advisory px-3 py-1 font-bold text-ink">Frozen. Draw on the still picture.</p>}
                {linkDown && <p className="rounded-md bg-caution px-3 py-1 font-bold text-ink">Connection lost. Reconnecting…</p>}
                {call.recording === "on" && <p className="rounded-md bg-warn px-3 py-1 font-bold">Recording</p>}
                {call.recording === "asking" && <p className="rounded-md bg-hangar/85 px-3 py-1">Asking the technician to allow recording…</p>}
              </div>
              <span className="rounded-md bg-hangar/85 p-2"><SignalBars quality={q} /></span>
            </div>
            {phase !== "live" && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div className="max-w-sm rounded-xl bg-panel/95 p-6">
                  {phase === "ended" ? (
                    <>
                      <p className="text-lg font-bold">Call ended</p>
                      <div className="mt-4 flex justify-center gap-3">
                        <Link className="rounded-md bg-blue px-4 py-2 font-bold" href={`/sessions/${sessionId}`}>Open report</Link>
                        <Link className="rounded-md border border-white/30 px-4 py-2 font-bold" href="/expert">Back to calls</Link>
                      </div>
                    </>
                  ) : phase === "error" ? (
                    <p>{call.error}</p>
                  ) : (
                    <p role="status">Connecting to {session?.technician.name ?? "the technician"}…</p>
                  )}
                  {call.mediaError && <p className="mt-3 text-sm text-caution">{call.mediaError}</p>}
                </div>
              </div>
            )}
          </Stage>
        </div>

        <div role="toolbar" aria-label="Drawing tools" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-panel-line p-3">
          <div className="flex flex-wrap gap-1">
            {TOOLS.map((t) => (
              <ToolButton key={t.id} label={t.label} icon={t.icon} pressed={tool === t.id} onClick={() => setTool(tool === t.id ? null : t.id)} />
            ))}
          </div>
          <div className="flex gap-1" aria-label="Colour">
            {EXPERT_COLOURS.map((c) => (
              <button
                key={c.value}
                aria-label={c.name}
                aria-pressed={colour === c.value}
                onClick={() => setColour(c.value)}
                className={`size-9 rounded-md border-2 ${colour === c.value ? "border-white" : "border-transparent"}`}
              >
                <span className="m-auto block size-5 rounded-sm ring-1 ring-black/50" style={{ background: c.value }} />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            <ToolButton label={call.frozen ? "Resume" : "Freeze"} icon={call.frozen ? Play : Pause} pressed={call.frozen} onClick={() => call.setFreeze(!call.frozen)} />
            <ToolButton label="Hand drawing" icon={Hand} pressed={call.hands} onClick={() => call.setHands(!call.hands)} disabled={!live} />
            <ToolButton label="Photo" icon={Camera} onClick={() => call.takePhoto()} />
            <ToolButton
              label={call.recording === "on" ? "Stop recording" : "Record"}
              icon={Disc}
              pressed={call.recording === "on"}
              onClick={() => (call.recording === "on" ? call.stopRecording() : call.requestRecording())}
              disabled={!live || call.recording === "asking"}
            />
          </div>
          <div className="flex gap-1">
            <ToolButton label="Undo" icon={Undo2} onClick={call.undo} />
            <ToolButton label="Clear all" icon={Eraser} onClick={call.clear} />
          </div>
          <div className="ml-auto flex gap-1">
            <ToolButton label={micOn ? "Mute" : "Muted"} icon={micOn ? Mic : MicOff} pressed={!micOn} onClick={() => setMicOn(!micOn)} />
            <ToolButton label={speakerOn ? "Sound on" : "Sound off"} icon={speakerOn ? Volume2 : VolumeX} pressed={!speakerOn} onClick={() => setSpeakerOn(!speakerOn)} />
          </div>
        </div>
      </section>

      {/* Right: work panels and connection */}
      <aside className="flex min-h-0 flex-col bg-hangar">
        <div role="tablist" aria-label="Session tools" className="grid grid-cols-4 border-b border-panel-line">
          {([["checklist", "Checklist"], ["chat", chatCount ? `Chat (${chatCount})` : "Chat"], ["notes", "Notes"], ["photos", photoCount ? `Photos (${photoCount})` : "Photos"]] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`px-2 py-3 text-sm ${tab === key ? "border-b-2 border-blue-bright font-bold" : "text-dim"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="min-h-64 flex-1 overflow-y-auto p-4">
          {tab === "checklist" && <ChecklistPanel call={call} />}
          {tab === "chat" && <Messages call={call} kind="chat" />}
          {tab === "notes" && <Messages call={call} kind="note" />}
          {tab === "photos" && <Media events={call.events} dark />}
        </div>
        <section aria-label="Connection" className="border-t border-panel-line p-4 text-sm">
          <p className="mb-2 flex items-center gap-2 font-bold">
            Connection <SignalBars quality={q} />
          </p>
          {q ? (
            <dl className="grid grid-cols-2 gap-y-1 text-dim tabular-nums">
              <dt>Delay</dt>
              <dd>{q.rttMs ?? "–"} ms</dd>
              <dt>Picture</dt>
              <dd>{q.width && q.height ? `${q.width}×${q.height}` : "–"}</dd>
              <dt>Frames</dt>
              <dd>{q.fps ?? "–"} fps</dd>
              <dt>Speed</dt>
              <dd>{q.kbps ?? "–"} kbps</dd>
              <dt>Loss</dt>
              <dd>{q.lossPct ?? "–"} %</dd>
            </dl>
          ) : (
            <p className="text-dim">Measured once the video is flowing.</p>
          )}
        </section>
      </aside>
    </main>
  );
}

function ToolButton({ label, icon: Icon, pressed, onClick, disabled }: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  pressed?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={pressed}
      disabled={disabled}
      className={`flex min-h-10 items-center gap-1.5 rounded-md px-2.5 text-sm disabled:opacity-40 ${pressed ? "bg-white font-bold text-ink" : "hover:bg-panel"}`}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
