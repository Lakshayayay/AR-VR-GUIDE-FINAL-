"use client";

// Sends the technician's camera pictures to the hand recogniser (hands.worker.ts, off the main
// thread) and turns what it sees into actions (lib/ar/hands.ts). It looks at the camera on its own
// schedule, next to the drawing tracker, so the hand never waits for the tracker (or the other way round).

import { useEffect, useRef, useState } from "react";
import { createHands, handBox, type HandEvent, type HandFrame } from "./hands";
import { arStats, meter } from "./stats";
import type { FromHandsWorker, ToHandsWorker } from "./hands.worker";

/** Pictures go to the recogniser at this size (longer side); it shrinks them further itself. */
const SIZE = 640;
/** A result this long after its picture was taken is thrown away (it would be a stale hand position). */
const STALE_MS = 300;

export function useHands(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  /** `capturedAt` says which video picture the hand was seen in; the stage uses it to find that picture's drawing placements. */
  onEvents: (events: HandEvent[], area: ReturnType<typeof handBox> | null, hand: HandFrame | null, capturedAt?: number) => void,
) {
  const [status, setStatus] = useState<"off" | "loading" | "ready" | "failed">("off");
  const handler = useRef(onEvents);
  handler.current = onEvents;

  useEffect(() => {
    if (!enabled) return setStatus("off");
    if (typeof Worker === "undefined") return setStatus("failed");
    const w = new Worker(new URL("./hands.worker.ts", import.meta.url));
    const hands = createHands();
    const handMeter = meter();
    let ready = false, busy = false, stopped = false, frameCallback = 0;
    let pending: { aspect: number; capturedAt: number; sentAt: number } | null = null;
    setStatus("loading");

    w.onmessage = (e: MessageEvent<FromHandsWorker>) => {
      const m = e.data;
      if (m.type === "ready") {
        ready = true;
        setStatus("ready");
      } else if (m.type === "failed") {
        console.warn("Hand tracking could not start:", m.error);
        setStatus("failed");
      } else {
        busy = false;
        const sample = pending;
        pending = null;
        const now = performance.now();
        // A late result is dropped, not read as "hand gone": one slow picture must never break a line.
        if (stopped || !sample || now - sample.capturedAt > STALE_MS) return;
        handMeter.tick(now);
        const events = hands.update(m.hand, m.ms, sample.aspect);
        Object.assign(arStats, {
          handFps: handMeter.perSecond(now), handMs: now - sample.sentAt, handDelay: now - sample.capturedAt,
          gesture: m.hand?.gesture ?? "no hand", score: m.hand?.score ?? 0, pinch: m.hand ? hands.gap() : 0,
        });
        handler.current(events, m.hand && handBox(m.hand), m.hand, sample.capturedAt);
      }
    };
    w.onerror = () => setStatus("failed");

    const onFrame = async (capturedAt: number) => {
      const v = videoRef.current;
      if (stopped || !v) return;
      frameCallback = v.requestVideoFrameCallback(onFrame);
      if (!ready || busy || !v.videoWidth) return; // one picture at a time: when the recogniser is slow, pictures are skipped, never queued
      busy = true;
      pending = { aspect: v.videoWidth / v.videoHeight, capturedAt, sentAt: performance.now() };
      const scale = Math.min(1, SIZE / Math.max(v.videoWidth, v.videoHeight));
      try {
        const bitmap = await createImageBitmap(v, { resizeWidth: Math.round(v.videoWidth * scale), resizeHeight: Math.round(v.videoHeight * scale) });
        if (stopped) return bitmap.close();
        w.postMessage({ bitmap, ms: capturedAt } satisfies ToHandsWorker, [bitmap]);
      } catch {
        busy = false;
        pending = null;
      }
    };
    frameCallback = videoRef.current?.requestVideoFrameCallback(onFrame) ?? 0;

    return () => {
      stopped = true;
      if (frameCallback) videoRef.current?.cancelVideoFrameCallback(frameCallback);
      w.terminate();
      // End an active stroke before clearing the cursor when hands are disabled or the call freezes.
      handler.current([{ type: "draw-end" }, { type: "erase-end" }, { type: "gone" }], null, null);
    };
  }, [enabled, videoRef]);

  return { status };
}
