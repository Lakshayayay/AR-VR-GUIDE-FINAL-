"use client";

// Connects a <video> to the anchor worker. For each video picture it sends a small grey copy to the
// worker and keeps the full picture; when the worker says where every drawing is on that picture,
// both are handed to `onPlaced` together. Drawing the picture and the drawings from the same moment
// is what stops drawings trailing behind the video.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnchorWire, Box, Placements, Point, Shape } from "@/lib/annotations";
import { holdLost, nearest, trackingQuality } from "./quality";
import { arStats, meter } from "./stats";
import type { FromWorker, ToWorker } from "./anchor.worker";

export type Finished = { anchor: AnchorWire | null; detail: number };

export function useAnchors(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onPlaced: (picture: ImageBitmap, placements: Placements, capturedAt: number) => void,
  stream: MediaStream | null,
) {
  const worker = useRef<Worker | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [limited, setLimited] = useState(false);
  const placements = useRef<Placements>({});
  const log = useRef<{ capturedAt: number; placements: Placements }[]>([]); // the last few tracked pictures
  const mask = useRef<Box | null>(null);
  const known = useRef(new Map<string, string>()); // shape id -> anchor picture the worker has ("" while drawing)
  const drawing = useRef(new Set<string>());
  const finishing = useRef(new Map<string, (f: Finished) => void>());
  const placedRef = useRef(onPlaced);
  placedRef.current = onPlaced;

  const send = (m: ToWorker, transfer: Transferable[] = []) => worker.current?.postMessage(m, transfer);

  useEffect(() => {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return setStatus("failed");
    const w = new Worker(new URL("./anchor.worker.ts", import.meta.url));
    worker.current = w;
    setStatus("loading");
    const pictures: { bitmap: ImageBitmap; capturedAt: number }[] = [];
    const quality = trackingQuality();
    const trackMeter = meter();
    const lostAt = new Map<string, number>(); // when each drawing was lost (see holdLost)
    let busy = false;
    let stopped = false;
    let frameCallback = 0;

    w.onmessage = (e: MessageEvent<FromWorker>) => {
      if (stopped) return;
      const m = e.data;
      if (m.type === "ready") setStatus("ready");
      else if (m.type === "failed") {
        console.warn("Drawings will not follow the camera:", m.error);
        setStatus("failed");
      } else if (m.type === "placed") {
        busy = false;
        const now = performance.now();
        trackMeter.tick(now);
        Object.assign(arStats, { trackFps: trackMeter.perSecond(now), trackMs: m.ms, trackSize: quality.size() });
        quality.frame(now, m.ms);
        setLimited(quality.limited());
        const shown = holdLost(m.placements, lostAt, now);
        placements.current = shown;
        const picture = pictures.shift();
        if (picture) {
          log.current.push({ capturedAt: picture.capturedAt, placements: shown });
          if (log.current.length > 10) log.current.shift();
          placedRef.current(picture.bitmap, shown, picture.capturedAt);
        }
      } else if (m.type === "anchored") {
        if (m.anchor) known.current.set(m.id, m.anchor.img);
        drawing.current.delete(m.id);
        finishing.current.get(m.id)?.({ anchor: m.anchor, detail: m.detail });
        finishing.current.delete(m.id);
      }
    };
    w.onerror = () => setStatus("failed");

    const next = () => {
      const v = videoRef.current;
      if (stopped || !v) return;
      frameCallback = v.requestVideoFrameCallback(onFrame);
    };
    const onFrame = async (capturedAt: number) => {
      const v = videoRef.current;
      if (stopped || !v) return;
      if (!busy && v.videoWidth) {
        // ponytail: a picture is only shown once the worker has placed it; if the phone is too slow, the
        // shown frame rate drops to the worker's. Show unplaced pictures in between if that ever matters.
        busy = true;
        const scale = Math.min(1, quality.size() / Math.max(v.videoWidth, v.videoHeight));
        let full: ImageBitmap | null = null;
        try {
          // The tracker and displayed image must come from the same capture, even if the
          // camera advances while the asynchronous bitmap operations are running.
          full = await createImageBitmap(v);
          const small = await createImageBitmap(full, { resizeWidth: Math.round(full.width * scale), resizeHeight: Math.round(full.height * scale), resizeQuality: "medium" });
          if (stopped) return [full, small].forEach((b) => b.close());
          pictures.push({ bitmap: full, capturedAt });
          send({ type: "frame", bitmap: small, mask: mask.current }, [small]);
        } catch {
          full?.close();
          busy = false;
        }
      }
      next();
    };

    // Start once the video has pictures; restart whenever its stream changes.
    const v = videoRef.current;
    const start = () => {
      if (frameCallback) v?.cancelVideoFrameCallback(frameCallback);
      quality.reset();
      setLimited(false);
      next();
    };
    v?.addEventListener("loadeddata", start);
    v?.addEventListener("play", start);
    start();

    return () => {
      stopped = true;
      if (frameCallback) v?.cancelVideoFrameCallback(frameCallback);
      v?.removeEventListener("loadeddata", start);
      v?.removeEventListener("play", start);
      pictures.forEach((p) => p.bitmap.close());
      finishing.current.forEach((resolve) => resolve({ anchor: null, detail: 0 }));
      finishing.current.clear();
      drawing.current.clear();
      placements.current = {};
      log.current = [];
      w.terminate();
      worker.current = null;
      known.current.clear();
    };
  }, [videoRef, stream]);

  /** Keeps the worker's anchors in step with the drawings: adds ones received, drops ones removed. */
  const sync = useCallback((shapes: Shape[]) => {
    const ids = new Set(shapes.map((s) => s.id));
    for (const s of shapes) {
      if (s.anchor && known.current.get(s.id) !== s.anchor.img && !drawing.current.has(s.id)) {
        known.current.set(s.id, s.anchor.img);
        send({ type: "add", id: s.id, img: s.anchor.img, box: s.anchor.box, exclude: s.anchor.exclude, focus: s.anchor.focus });
      }
    }
    for (const id of [...known.current.keys()]) {
      if (!ids.has(id) && !drawing.current.has(id)) {
        known.current.delete(id);
        delete placements.current[id];
        send({ type: "remove", id });
      }
    }
  }, []);

  return {
    status,
    limited,
    placements,
    /**
     * Where the drawings were on the tracked picture captured nearest to `capturedAt` (the hand recogniser
     * looks at pictures on its own schedule, so it asks for the matching placements), else the latest.
     */
    placementsAt: (capturedAt?: number): Placements =>
      (capturedAt === undefined ? undefined : nearest(log.current, capturedAt)?.placements) ?? placements.current,
    sync,
    /** A drawing starts at `p` (fractions of the picture on screen): anchor it there for now. */
    begin(id: string, [x, y]: Point) {
      drawing.current.add(id);
      known.current.set(id, "");
      send({ type: "begin", id, x, y });
    },
    /** A drawing is finished: anchor it to the area it covers. Resolves with the anchor to send. */
    finish(id: string, around: Box): Promise<Finished> {
      if (!worker.current || status !== "ready") {
        drawing.current.delete(id);
        return Promise.resolve({ anchor: null, detail: 0 });
      }
      return new Promise((resolve) => {
        finishing.current.set(id, resolve);
        send({ type: "finish", id, around });
      });
    },
    /** Hide an area (the technician's hand) from tracking, or null. */
    setMask(box: Box | null) {
      mask.current = box;
    },
  };
}
