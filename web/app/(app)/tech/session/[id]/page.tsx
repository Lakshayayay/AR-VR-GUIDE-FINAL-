"use client";

import { Camera, Flashlight, MessageSquare, Mic, MicOff, Pencil, SwitchCamera, Undo2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { SignalBars, Stage } from "@/components/call/stage";
import { useCall } from "@/components/call/use-call";
import { Button, Dialog } from "@/components/ui";
import { Messages, StepCard } from "@/components/work";
import { TECH_COLOUR } from "@/lib/annotations";
import { clock, since, useNow } from "@/lib/format";

const RING_SECONDS = 45;

export default function TechnicianCall() {
  const { id } = useParams<{ id: string }>();
  const call = useCall(Number(id), "technician");
  const { socket, toast } = useApp();
  const router = useRouter();
  const now = useNow();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [muted, setMuted] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSeen, setChatSeen] = useState(0);
  const [stepsOpen, setStepsOpen] = useState(true);
  const [torch, setTorch] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ringStart, setRingStart] = useState(0);

  const { phase, session } = call;
  const expertName = session?.expert?.name ?? "the expert";
  const videoTrack = call.local?.getVideoTracks()[0];
  const canTorch = !!(videoTrack?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch;
  const chats = call.events.filter((e) => e.kind === "chat");
  const unread = chatOpen ? 0 : chats.slice(chatSeen).filter((e) => e.user?.id !== call.me.id).length;

  useEffect(() => call.local?.getAudioTracks().forEach((t) => (t.enabled = !muted)), [muted, call.local]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = call.remote;
  }, [call.remote]);

  // Nobody answered in time: record it as missed.
  useEffect(() => {
    if (phase !== "waiting") return;
    setRingStart(Date.now());
    const t = setTimeout(() => call.end("timeout"), RING_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const flip = async () => {
    const next = facing === "environment" ? "user" : "environment";
    videoTrack?.stop(); // many phones cannot open two cameras at once
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: next }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      await call.replaceVideo(s.getVideoTracks()[0]);
      setFacing(next);
      setTorch(false);
    } catch {
      toast("Could not switch camera.");
    }
  };

  const toggleTorch = async () => {
    try {
      await videoTrack?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      toast("The light could not be switched on this phone.");
    }
  };

  const callAgain = async () => {
    try {
      const r = await socket.timeout(8000).emitWithAck("call:start", { aircraft: session?.aircraft, checklistId: session?.checklist?.id });
      if (r.ok) router.replace(`/tech/session/${r.session.id}`);
      else toast(r.error);
    } catch {
      toast("No reply from the server. Try again.");
    }
  };

  const linkDown = phase === "live" && (!call.other || call.link === "disconnected" || call.link === "failed");
  const hasSteps = !!session?.checklist?.steps.length;

  return (
    <main className="live fixed inset-0 overflow-hidden">
      <Stage
        videoRef={videoRef}
        stream={call.local}
        muted
        frozen={call.frozen}
        shapes={call.shapes}
        pointer={call.pointer}
        tool={drawing ? "pen" : null}
        colour={TECH_COLOUR}
        author={call.me.id}
        onPut={call.putShape}
        label="Your camera"
      />
      <audio ref={audioRef} autoPlay />
      {call.frozen && <div aria-hidden className="pointer-events-none absolute inset-0 border-4 border-advisory" />}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <div className="rounded-lg bg-hangar/85 px-3 py-2">
          <p className="font-mono text-lg leading-none">{phase === "live" || phase === "connecting" ? clock(since(session?.startedAt, now)) : "--:--"}</p>
          <p className="mt-1 text-sm text-dim">{session?.expert ? session.expert.name : session?.code}</p>
        </div>
        <div className="flex items-center gap-2">
          {call.recording === "on" && (
            <span className="rounded-md bg-warn px-2 py-1 text-xs font-bold" role="status">
              Recording
            </span>
          )}
          <span className="rounded-lg bg-hangar/85 p-3">
            <SignalBars quality={call.quality} />
          </span>
          {canTorch && (
            <button onClick={toggleTorch} aria-pressed={torch} aria-label="Light" className={`grid size-14 place-items-center rounded-xl ${torch ? "bg-white text-ink" : "bg-hangar/85"}`}>
              <Flashlight aria-hidden className="size-6" />
            </button>
          )}
        </div>
      </div>

      {/* Status banners */}
      <div className="absolute inset-x-3 top-24 space-y-2" aria-live="polite">
        {call.frozen && <p className="rounded-lg bg-advisory px-3 py-2 font-bold text-ink">Picture frozen by {expertName}. Hold still.</p>}
        {linkDown && <p className="rounded-lg bg-caution px-3 py-2 font-bold text-ink">Connection lost. Reconnecting…</p>}
        {phase === "connecting" && <p className="rounded-lg bg-hangar/85 px-3 py-2">Connecting to {expertName}…</p>}
      </div>

      {/* Bottom: step card, then controls */}
      {(phase === "live" || phase === "connecting") && (
        <div className="absolute inset-x-0 bottom-0 space-y-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {hasSteps && (stepsOpen ? (
            <StepCard call={call} onHide={() => setStepsOpen(false)} />
          ) : (
            <button onClick={() => setStepsOpen(true)} className="rounded-lg bg-panel/95 px-3 py-2 text-sm font-bold">
              Show checklist step
            </button>
          ))}
          {drawing && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-hangar/85 px-3 py-2">
              <p className="text-sm">Draw on the picture with your finger.</p>
              <Button onClick={call.undo}>
                <Undo2 aria-hidden className="size-4" /> Undo
              </Button>
            </div>
          )}
          <div className="grid grid-cols-5 gap-2">
            <Control label={muted ? "Muted" : "Mute"} pressed={muted} onClick={() => setMuted(!muted)} icon={muted ? MicOff : Mic} />
            <Control label="Flip" onClick={flip} icon={SwitchCamera} />
            <Control label="Draw" pressed={drawing} onClick={() => setDrawing(!drawing)} icon={Pencil} />
            <Control label="Photo" onClick={() => call.takePhoto(videoRef.current)} icon={Camera} />
            <Control
              label={unread ? `Chat (${unread})` : "Chat"}
              onClick={() => {
                setChatOpen(true);
                setChatSeen(chats.length);
              }}
              icon={MessageSquare}
            />
          </div>
          <Button variant="danger" size="lg" className="w-full" onClick={() => call.end()}>
            End call
          </Button>
        </div>
      )}

      {/* Whole-screen states */}
      {(phase === "joining" || phase === "waiting" || phase === "ended" || phase === "error" || call.mediaError) && (
        <div className="absolute inset-x-3 bottom-3 rounded-xl bg-panel/95 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {call.mediaError && phase !== "ended" ? (
            <>
              <p className="text-lg font-bold">Camera not available</p>
              <p className="mt-2 text-dim">{call.mediaError}</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button size="lg" onClick={() => call.end()}>Cancel call</Button>
                <Button size="lg" variant="primary" onClick={() => window.location.reload()}>Try again</Button>
              </div>
            </>
          ) : phase === "joining" ? (
            <p role="status">Starting camera…</p>
          ) : phase === "waiting" ? (
            <>
              <p className="text-lg font-bold">Calling an expert…</p>
              <p className="mt-1 text-dim">
                {session?.aircraft || "No aircraft given"}
                {session?.checklist && `, ${session.checklist.name}`}
              </p>
              <p className="mt-3 font-mono text-dim" aria-live="off">
                Ringing for up to {Math.max(0, Math.ceil(RING_SECONDS - (now - ringStart) / 1000))} s
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button size="lg" onClick={() => call.end()}>Cancel call</Button>
                <Button
                  size="lg"
                  onClick={() =>
                    navigator.clipboard
                      ?.writeText(`${location.origin}/expert/session/${id}`)
                      .then(() => toast("Link copied. Send it to an expert."), () => toast("Could not copy the link."))
                  }
                >
                  Copy link
                </Button>
              </div>
            </>
          ) : phase === "ended" ? (
            <>
              <p className="text-lg font-bold">
                {session?.status === "missed" ? "No expert answered" : session?.status === "cancelled" ? "Call cancelled" : "Call ended"}
              </p>
              {session?.status === "missed" && <p className="mt-1 text-dim">Everyone may be busy. Try again, or send a message to your lead.</p>}
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {session?.status !== "ended" && <Button size="lg" variant="primary" onClick={callAgain}>Call again</Button>}
                {session?.status === "ended" && <Link href={`/sessions/${id}`} className="grid min-h-14 place-items-center rounded-md bg-blue font-bold">See report</Link>}
                <Link href="/tech" className="grid min-h-14 place-items-center rounded-md border border-white/30 font-bold">Home</Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-lg font-bold">This call could not open</p>
              <p className="mt-2 text-dim">{call.error}</p>
              <Link href="/tech" className="mt-4 grid min-h-14 place-items-center rounded-md border border-white/30 font-bold">Home</Link>
            </>
          )}
        </div>
      )}

      {/* Chat sheet */}
      {chatOpen && (
        <section aria-label="Chat" className="absolute inset-x-0 bottom-0 flex h-[70dvh] flex-col rounded-t-2xl border-t border-panel-line bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">Chat with {expertName}</h2>
            <Button onClick={() => { setChatOpen(false); setChatSeen(chats.length); }}>Close</Button>
          </div>
          <Messages call={call} kind="chat" />
        </section>
      )}

      <Dialog open={call.consentAsked} onClose={() => call.answerRecording(false)} label="Recording request">
        <p className="text-lg font-bold">{expertName} wants to record this call</p>
        <p className="mt-2 text-dim">The recording is saved to this session. You will see “Recording” at the top while it runs.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button size="lg" onClick={() => call.answerRecording(false)}>Don’t allow</Button>
          <Button size="lg" variant="primary" onClick={() => call.answerRecording(true)}>Allow</Button>
        </div>
      </Dialog>
    </main>
  );
}

function Control({ label, icon: Icon, pressed, onClick }: {
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={pressed}
      className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs font-bold ${pressed ? "bg-white text-ink" : "bg-hangar/85"}`}
    >
      <Icon aria-hidden className="size-6" />
      {label}
    </button>
  );
}
