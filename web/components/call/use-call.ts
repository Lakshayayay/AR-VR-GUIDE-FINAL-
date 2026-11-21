"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { applyErase, capture, undoErase, type EraseChange, type Point, type Shape } from "@/lib/annotations";
import { api } from "@/lib/api";
import { drawingLifetime } from "@/lib/drawing-lifetime";
import type { Person, Session, SessionEvent, SignOff, StepResult } from "@/lib/types";
import { createPeer, watchQuality, type Peer, type Quality, type Signal } from "@/lib/webrtc";

export type Phase = "joining" | "waiting" | "connecting" | "live" | "ended" | "error";
type Side = "technician" | "expert";

interface JoinReply {
  ok: boolean;
  error?: string;
  session: Session;
  steps: StepResult[];
  events: SessionEvent[];
  shapes?: Shape[];
  history?: { kind: "shape" | "erase"; id: string }[];
  frozen?: boolean;
  hands?: boolean;
  peers?: (Person & { role: string })[];
}

/** Everything a live call needs, shared by the technician's phone and the expert's console. */
export function useCall(sessionId: number, side: Side) {
  const { socket, me, toast } = useApp();
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>("joining");
  const [error, setError] = useState("");
  const [shapes, setShapes] = useState<Record<string, Shape>>({});
  const [frozen, setFrozen] = useState(false);
  const [hands, setHandsOn] = useState(true); // hands-free drawing on the technician's phone
  const [pointer, setPointer] = useState<Point | null>(null);
  const [steps, setSteps] = useState<Record<number, StepResult>>({});
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [signedOff, setSignedOff] = useState<SignOff | null>(null);
  const [other, setOther] = useState<Person | null>(null);
  const [link, setLink] = useState<RTCPeerConnectionState>("new");
  const [quality, setQuality] = useState<Quality | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState("");
  const [recording, setRecording] = useState<"off" | "asking" | "on">("off");
  const [consentAsked, setConsentAsked] = useState(false);

  const peer = useRef<Peer | null>(null);
  const stopWatch = useRef<() => void>(() => {});
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const otherRef = useRef<Person | null>(null);
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const mine = useRef<{ kind: "shape" | "erase"; id: string }[]>([]);
  const lifetime = useRef(drawingLifetime());
  const recorder = useRef<MediaRecorder | null>(null);
  const evidenceRef = useRef<HTMLCanvasElement | null>(null);
  // Set-up messages are handled one at a time, and only once camera/microphone and network settings are ready.
  const ice = useRef<RTCIceServer[]>([]);
  const settled = useRef(false);
  const waiters = useRef<(() => void)[]>([]);
  const mediaSettled = () => (settled.current ? Promise.resolve() : new Promise<void>((r) => waiters.current.push(r)));
  const queue = useRef<Promise<void>>(Promise.resolve());

  const stopMedia = useCallback(() => {
    stopWatch.current();
    peer.current?.close();
    peer.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // Camera (technician) or microphone (expert), asked for first so the preview appears quickly.
  useEffect(() => {
    // React may start this twice (development mode does on purpose); only the run still in use counts.
    let cancelled = false;
    settled.current = false;
    const constraints: MediaStreamConstraints =
      side === "technician"
        ? { audio: true, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }
        : { audio: true, video: false };
    const iceLoaded = api<{ iceServers: RTCIceServer[] }>("/config").then((r) => { ice.current = r.iceServers; }, () => {});
    const media = navigator.mediaDevices
      ? navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
          if (cancelled) return stream.getTracks().forEach((t) => t.stop());
          localRef.current = stream;
          setLocal(stream);
        }, (e) => !cancelled && setMediaError(mediaMessage(e, side)))
      : Promise.resolve(setMediaError(mediaMessage(null, side)));
    Promise.all([iceLoaded, media]).finally(() => {
      if (cancelled) return;
      settled.current = true;
      waiters.current.splice(0).forEach((resolve) => resolve());
    });
    return () => {
      cancelled = true;
      stopMedia();
    };
  }, [side, stopMedia]);

  const makePeer = (id: string) => {
    stopWatch.current();
    peer.current?.close();
    const p = createPeer({
      id,
      iceServers: ice.current,
      local: localRef.current,
      send: (data) => socket.emit("signal", { sessionId, data }),
      onRemote: (stream) => {
        remoteRef.current = stream;
        setRemote(stream);
      },
      onState: (state) => {
        setLink(state);
        if (state === "connected") setPhase((ph) => (ph === "connecting" ? "live" : ph));
        if (state === "failed" && side === "technician") setTimeout(() => otherRef.current && run(() => offer(true)), 1500);
      },
    });
    stopWatch.current = watchQuality(p.pc, setQuality);
    peer.current = p;
    return p;
  };

  const run = (task: () => Promise<void>) => {
    queue.current = queue.current.then(mediaSettled).then(task).catch(() => {});
  };

  // The technician (who has the camera) always starts the video connection.
  const offer = async (force: boolean) => {
    if (!localRef.current || (!force && peer.current?.pc.connectionState === "connected")) return;
    await makePeer(crypto.randomUUID()).offer();
  };

  const onSignal = async (data: Signal) => {
    if (data.type === "offer") {
      if (side !== "expert") return;
      makePeer(data.id);
    }
    await peer.current?.receive(data);
  };

  // ---------- recording (expert side, only after the technician agrees) ----------

  const upload = async (blob: Blob, kind: "photo" | "recording", name: string) => {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", blob, name);
    await api(`/sessions/${sessionId}/files`, { method: "POST", body: form });
  };

  const startRecording = () => {
    const canvas = evidenceRef.current;
    if (!canvas?.width || !canvas.height || !canvas.captureStream) return toast("There is no picture to record yet.");
    const type = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) return toast("Recording is not supported by this browser.");
    const video = canvas.captureStream(30);
    const mix = new AudioContext();
    const out = mix.createMediaStreamDestination();
    for (const s of [remoteRef.current, localRef.current]) {
      if (s?.getAudioTracks().length) mix.createMediaStreamSource(s).connect(out);
    }
    const rec = new MediaRecorder(new MediaStream([...video.getVideoTracks(), ...out.stream.getAudioTracks()]), { mimeType: type });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      void mix.close();
      video.getTracks().forEach((t) => t.stop());
      const blob = new Blob(parts, { type: type.split(";")[0] });
      upload(blob, "recording", type.includes("mp4") ? "call.mp4" : "call.webm").then(
        () => toast("Recording saved to the session."),
        () => toast("The recording could not be saved."),
      );
    };
    rec.start(1000);
    recorder.current = rec;
    setRecording("on");
    socket.emit("record:state", { sessionId, on: true });
  };

  const stopRecording = () => {
    if (!recorder.current) return;
    recorder.current.stop();
    recorder.current = null;
    setRecording("off");
    socket.emit("record:state", { sessionId, on: false });
  };

  // Listener code runs long after this render; keep it pointing at the latest functions.
  const latest = useRef({ run, offer, onSignal, startRecording, stopRecording, stopMedia });
  latest.current = { run, offer, onSignal, startRecording, stopRecording, stopMedia };

  // ---------- live connection ----------

  useEffect(() => {
    const f = () => latest.current;
    const meetOther = (user: Person | null, force: boolean) => {
      otherRef.current = user;
      setOther(user);
      if (user && side === "technician") f().run(() => f().offer(force));
    };

    const join = async () => {
      try {
        const r: JoinReply = await socket.timeout(8000).emitWithAck("session:join", { sessionId });
        if (!r.ok) {
          setError(r.error ?? "Session not found.");
          setPhase("error");
          return;
        }
        setSession(r.session);
        setSteps(Object.fromEntries(r.steps.map((s) => [s.step, s])));
        setEvents(r.events);
        setSignedOff(r.session.signedOff);
        lifetime.current.reconcile((r.shapes ?? []).map((s) => s.id));
        mine.current = r.history ?? [];
        setShapes(Object.fromEntries((r.shapes ?? []).map((s) => [s.id, s])));
        setFrozen(!!r.frozen);
        setHandsOn(r.hands ?? true);
        if (r.session.status === "waiting") setPhase("waiting");
        else if (r.session.status === "active") {
          setPhase((ph) => (ph === "live" ? "live" : "connecting"));
          meetOther(r.peers?.[0] ?? null, false);
        } else {
          setPhase("ended");
          f().stopRecording();
          f().stopMedia();
        }
      } catch {
        setError("No reply from the server. Check your connection, then reload the page.");
        setPhase("error");
      }
    };

    const handlers: Record<string, (d: any) => void> = {
      connect: join,
      "call:accepted": ({ session }: { session: Session }) => {
        setSession(session);
        setPhase((ph) => (ph === "waiting" ? "connecting" : ph));
      },
      "call:ended": ({ status, by }: { status: Session["status"]; by: Person }) => {
        setSession((s) => s && { ...s, status });
        setPhase("ended");
        f().stopRecording();
        f().stopMedia();
        if (by.id !== me.id && status === "ended") toast(`${by.name} ended the call.`);
      },
      "peer:joined": ({ user }) => meetOther(user, true),
      "peer:left": () => {
        otherRef.current = null;
        setOther(null);
      },
      signal: ({ data }: { data: Signal }) => f().run(() => f().onSignal(data)),
      // A drawing's anchor is sent once; later updates without one keep it.
      "ann:put": ({ shape }: { shape: Shape }) => {
        if (lifetime.current.put(shape.id)) setShapes((s) => ({ ...s, [shape.id]: { ...s[shape.id], ...shape } }));
      },
      "ann:remove": ({ id }: { id: string }) => {
        lifetime.current.remove(id);
        setShapes(({ [id]: _, ...rest }) => rest);
      },
      "ann:clear": () => {
        lifetime.current.clear();
        mine.current = [];
        setShapes({});
      },
      "ann:erase": ({ opId, changes }: { opId: string; changes: EraseChange[] }) => setShapes((s) => applyErase(s, opId, changes)),
      "ann:erase:undo": ({ opId }: { opId: string }) => setShapes((s) => undoErase(s, opId)),
      pointer: (d) => setPointer(d.off ? null : [d.x, d.y]),
      freeze: (d) => setFrozen(!!d.frozen),
      hands: (d) => setHandsOn(!!d.on),
      "step:update": (r) =>
        setSteps(({ [r.step]: _, ...rest }) => (r.status ? { ...rest, [r.step]: r } : rest)),
      "signoff:update": (s: SignOff) => setSignedOff(s),
      "event:new": (e: SessionEvent) => setEvents((list) => (list.some((x) => x.id === e.id) ? list : [...list, e])),
      "record:request": () => setConsentAsked(true),
      "record:answer": ({ allowed }) => {
        if (allowed) f().startRecording();
        else {
          setRecording("off");
          toast("The technician did not allow recording.");
        }
      },
      "record:state": ({ on }) => setRecording(on ? "on" : "off"),
    };
    for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn);
    if (socket.connected) void join();
    return () => {
      for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn);
      f().stopRecording();
      socket.emit("session:leave", { sessionId });
    };
  }, [socket, sessionId, side, me.id, toast]);

  // Keep the screen awake during a call.
  useEffect(() => {
    if (phase !== "live" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request("screen").then((l) => (lock = l), () => {});
    return () => void lock?.release();
  }, [phase]);

  // ---------- actions ----------

  const ask = async (event: string, data: object): Promise<boolean> => {
    try {
      const r = await socket.timeout(8000).emitWithAck(event, { sessionId, ...data });
      if (r?.ok) return true;
      toast(r?.error ?? "That did not save. Try again.");
    } catch {
      toast("No reply from the server. Try again.");
    }
    return false;
  };

  return {
    me, session, phase, error, local, remote, mediaError, other, link, quality, evidenceRef,
    shapes: Object.values(shapes), frozen, hands, pointer, steps, events, signedOff, recording, consentAsked,

    putShape(shape: Shape) {
      if (!lifetime.current.put(shape.id)) return;
      if (!mine.current.some((a) => a.kind === "shape" && a.id === shape.id)) mine.current.push({ kind: "shape", id: shape.id });
      setShapes((s) => ({ ...s, [shape.id]: { ...s[shape.id], ...shape } }));
      socket.emit("ann:put", { sessionId, shape });
    },
    undo() {
      let action = mine.current.pop();
      while (action?.kind === "shape" && !shapesRef.current[action.id]) action = mine.current.pop();
      if (!action) return;
      if (action.kind === "erase") {
        socket.emit("ann:erase:undo", { sessionId, opId: action.id }, (r: { ok: boolean }) => {
          if (!r?.ok) toast("Could not undo the rubbing. Try again.");
        });
        return;
      }
      lifetime.current.remove(action.id);
      setShapes(({ [action.id]: _, ...rest }) => rest);
      socket.emit("ann:remove", { sessionId, id: action.id });
    },
    erase(opId: string, batch: number, changes: EraseChange[]) {
      if (!changes.length) return;
      if (!mine.current.some((a) => a.kind === "erase" && a.id === opId)) mine.current.push({ kind: "erase", id: opId });
      socket.emit("ann:erase", { sessionId, opId, batch, changes }, (r: { ok: boolean }) => {
        if (!r?.ok) toast("Could not erase that area. Check your connection.");
      });
    },
    clear() {
      lifetime.current.clear();
      mine.current = [];
      setShapes({});
      socket.emit("ann:clear", { sessionId });
    },
    sendPointer(p: Point | null) {
      socket.emit("pointer", p ? { sessionId, x: p[0], y: p[1] } : { sessionId, off: true });
    },
    setFreeze(on: boolean) {
      setFrozen(on);
      socket.emit("freeze", { sessionId, frozen: on });
    },
    setHands(on: boolean) {
      setHandsOn(on);
      socket.emit("hands", { sessionId, on });
    },
    setStep: (step: number, status: "done" | "problem" | null, note = "") => ask("step:set", { step, status, note }),
    signOff: () => ask("signoff", {}),
    send: (kind: "chat" | "note", text: string) => ask("msg", { kind, text }),
    async takePhoto() {
      const canvas = evidenceRef.current;
      if (!canvas?.width || !canvas.height) return toast("There is no picture to save yet.");
      try {
        const blob = await capture(canvas);
        await upload(blob, "photo", "photo.jpg");
        toast("Photo saved to the session.");
      } catch {
        toast("The photo could not be saved. Try again.");
      }
    },
    requestRecording() {
      setRecording("asking");
      socket.emit("record:request", { sessionId });
    },
    stopRecording,
    answerRecording(allowed: boolean) {
      setConsentAsked(false);
      socket.emit("record:answer", { sessionId, allowed });
    },
    /** Swap the camera's video in the live call (front/back camera). */
    async replaceVideo(track: MediaStreamTrack) {
      const old = localRef.current;
      old?.getVideoTracks().forEach((t) => t.stop());
      const next = new MediaStream([track, ...(old?.getAudioTracks() ?? [])]);
      localRef.current = next;
      setLocal(next);
      await peer.current?.pc.getSenders().find((s) => s.track?.kind === "video")?.replaceTrack(track);
    },
    end(reason?: "timeout") {
      stopRecording();
      socket.emit("call:end", { sessionId, reason });
    },
  };
}

export type Call = ReturnType<typeof useCall>;

function mediaMessage(e: unknown, side: Side): string {
  const what = side === "technician" ? "The camera" : "The microphone";
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return `${what} only works on a secure page. Open ArGuide with its https:// address.`;
  }
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return `${what} is blocked. Allow access in your browser's site settings, then reload.`;
  if (name === "NotFoundError") {
    return side === "technician"
      ? "No camera was found on this device."
      : "No microphone found. You can still watch and draw, but the technician will not hear you.";
  }
  return `${what} could not start. Close other apps that use it, then reload.`;
}
