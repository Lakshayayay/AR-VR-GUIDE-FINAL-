"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  bounds, contentBox, drawPointer, drawShapes, mapPoint, newShapeId, type Box, type Placements, type Point, type Shape, type Tool,
} from "@/lib/annotations";
import { invertH } from "@/lib/ar/anchor-core";
import { handConnections, type Landmark } from "@/lib/ar/hands";
import { eraseChanges } from "@/lib/ar/erase";
import type { EraseChange } from "@/lib/annotations";
import { useAnchors } from "@/lib/ar/use-anchors";
import { trackingNotice } from "@/lib/ar/quality";
import { arStats } from "@/lib/ar/stats";
import type { Quality } from "@/lib/webrtc";
import { ArDebug } from "./ar-debug";

/** What a dashed or loose drawing means, in plain words (see `trackingNotice` in lib/ar/quality.ts). */
export const TRACKING_NOTICE = {
  lost: "Lost the part this was drawn on. Dashed lines wait for it to come back into view.",
  fixed: "Too dark or too plain to stick drawings to the part. They stay where you drew them on the screen.",
} as const;
export type TrackingNotice = keyof typeof TRACKING_NOTICE | "";

/** Under this many corner points an anchor holds poorly (see anchor-core `detail`). */
const WEAK_ANCHOR = 20;

/** Lets hands-free drawing (lib/ar/use-hands.ts) draw on the Stage without re-rendering the page. */
export interface HandPen {
  start(p: Point): void;
  /** `capturedAt`: the video picture the hand was seen in (the tracker's placements for that picture are used). */
  move(p: Point, capturedAt?: number): void;
  end(): void;
  /** The fingertip, shown as a cursor (null: no hand). */
  cursor(p: Point | null): void;
  /** The area the hand covers, hidden from tracking (a hand is not part of the aircraft). */
  mask(b: Box | null): void;
  hand(points: Landmark[] | null): void;
  rub(at: Point, radius: number, capturedAt?: number): EraseChange[];
  endRub(): void;
}

/**
 * Video with the drawing layer on top. Both screens use it. Each drawing is anchored to the part under
 * it and redrawn with every video picture, so it stays on the part as the camera moves (lib/ar).
 */
export function Stage({
  videoRef, stream, muted, frozen, shapes, pointer, tool, colour, author, onPut, onPointer, onWeakAnchor, placementsRef, penRef, evidenceRef, showHand = true, onNotice,
  label, children,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  muted: boolean;
  frozen: boolean;
  shapes: Shape[];
  pointer: Point | null;
  tool: Tool | "pointer" | null;
  colour: string;
  author: number;
  onPut?: (shape: Shape) => void;
  onPointer?: (p: Point | null) => void;
  /** Called when a finished drawing sits on an area with too little detail to hold it. */
  onWeakAnchor?: () => void;
  /** Filled with the latest placements, for photos. */
  placementsRef?: React.RefObject<Placements>;
  penRef?: React.Ref<HandPen>;
  /** Camera picture and annotations only, used for photos and consented recording. */
  evidenceRef?: React.RefObject<HTMLCanvasElement | null>;
  showHand?: boolean;
  /** Told what to say about dashed or loose drawings. Without it the stage shows the message itself (bottom right). */
  onNotice?: (notice: TrackingNotice) => void;
  label: string;
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Shape | null>(null);
  const frame = useRef(0);
  const picture = useRef<ImageBitmap | null>(null);
  const evidence = useRef<HTMLCanvasElement | null>(null);
  const [textAt, setTextAt] = useState<{ point: Point; left: number; top: number } | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [notice, setNotice] = useState<TrackingNotice>("");
  const [debug, setDebug] = useState(false); // ?debug=ar shows the AR numbers (components/call/ar-debug.tsx)
  useEffect(() => {
    setDebug(new URLSearchParams(location.search).get("debug") === "ar");
  }, []);
  const [, setSize] = useState(0);

  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = 0;
    c.height = 0;
    evidence.current = c;
    if (evidenceRef) evidenceRef.current = c;
    return () => {
      evidence.current = null;
      if (evidenceRef?.current === c) evidenceRef.current = null;
    };
  }, [evidenceRef]);

  const cursor = useRef<Point | null>(null);
  const keyboardPoint = useRef<Point>([0.5, 0.5]);
  const hand = useRef<Landmark[] | null>(null);
  const previousRub = useRef<Point | null>(null);
  // Latest props for drawing outside React renders (once per video picture).
  const live = useRef({ shapes, pointer, colour });
  live.current = { shapes, pointer, colour };

  const box = () => {
    const canvas = canvasRef.current!;
    const v = videoRef.current;
    return contentBox(v?.videoWidth ?? 0, v?.videoHeight ?? 0, canvas.clientWidth, canvas.clientHeight);
  };

  /** Where to draw each shape. A stroke still being drawn is never shown as lost (dashed): it is being drawn right now. */
  const shownPlacements = (): Placements => {
    const id = drawing.current?.id, placed = id ? anchors.placements.current[id] : undefined;
    return id && placed?.state === "searching" ? { ...anchors.placements.current, [id]: { ...placed, state: "locked" } } : anchors.placements.current;
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const b = box();
    const { shapes, pointer, colour } = live.current;
    const image = picture.current;
    const output = evidence.current;
    if (image && output) {
      if (output.width !== image.width || output.height !== image.height) {
        output.width = image.width;
        output.height = image.height;
      }
      const out = output.getContext("2d")!;
      out.clearRect(0, 0, output.width, output.height);
      out.drawImage(image, 0, 0);
      drawShapes(out, shapes, { x: 0, y: 0, w: output.width, h: output.height }, getComputedStyle(canvas).fontFamily, shownPlacements());
      ctx.drawImage(output, b.x, b.y, b.w, b.h);
    } else {
      if (image) ctx.drawImage(image, b.x, b.y, b.w, b.h);
      drawShapes(ctx, shapes, b, getComputedStyle(canvas).fontFamily, shownPlacements());
    }
    if (pointer) drawPointer(ctx, pointer, b);
    if (showHand && hand.current) {
      ctx.save();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.lineWidth = 5;
      const segments = handConnections(hand.current);
      for (const width of [5, 2]) {
        ctx.lineWidth = width;
        if (width === 2) ctx.strokeStyle = colour;
        ctx.beginPath();
        for (const [a, z] of segments) {
          ctx.moveTo(b.x + a.x * b.w, b.y + a.y * b.h);
          ctx.lineTo(b.x + z.x * b.w, b.y + z.y * b.h);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    if (cursor.current) drawPointer(ctx, cursor.current, b, colour);
    if (keyboardFocus && tool) drawPointer(ctx, keyboardPoint.current, b, colour);
  };

  const anchors = useAnchors(videoRef, (next, placements) => {
    picture.current?.close();
    picture.current = next;
    if (placementsRef) placementsRef.current = placements;
    setNotice(trackingNotice(placements)); // only re-renders when the message changes
    draw();
  }, stream);
  useEffect(() => {
    onNotice?.(notice);
  }, [notice, onNotice]);

  // Hand results arrive on their own schedule, next to the tracker. Repaint (at most once per screen frame)
  // as soon as one does, so the outline and cursor move with the hand even when tracking is slower.
  const drawLatest = useRef(draw);
  drawLatest.current = draw;
  const drawQueued = useRef(0);
  const requestDraw = () => {
    if (drawQueued.current) return;
    drawQueued.current = requestAnimationFrame(() => {
      drawQueued.current = 0;
      drawLatest.current();
    });
  };
  useEffect(() => () => cancelAnimationFrame(drawQueued.current), []);

  useEffect(() => anchors.sync(shapes), [shapes, anchors.sync, stream]);
  useEffect(() => () => picture.current?.close(), []);

  useEffect(() => {
    const v = videoRef.current;
    if (v && v.srcObject !== stream) {
      v.srcObject = stream;
      picture.current?.close();
      picture.current = null; // a new camera: show it live until the first placed picture
    }
  }, [stream, videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (frozen) v.pause();
    else void v.play().catch(() => {});
  }, [frozen, stream, videoRef]);

  // Redraw when the window resizes or the video size becomes known.
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const bump = () => setSize((n) => n + 1);
    const observer = new ResizeObserver(bump);
    observer.observe(canvas);
    video.addEventListener("resize", bump);
    video.addEventListener("loadedmetadata", bump);
    return () => {
      observer.disconnect();
      video.removeEventListener("resize", bump);
      video.removeEventListener("loadedmetadata", bump);
    };
  }, [videoRef]);

  // And whenever the drawings or pointer change (between video pictures, or while frozen).
  useEffect(draw);

  const toPoint = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const b = box();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return [clamp((e.clientX - rect.left - b.x) / b.w), clamp((e.clientY - rect.top - b.y) / b.h)];
  };

  /** A point on screen, in the terms of the picture the drawing is anchored to (the camera may have moved). */
  const toAnchored = (id: string, p: Point, source = anchors.placements.current): Point => {
    const placed = source[id];
    return placed ? mapPoint(invertH(placed.h), p) : p;
  };

  // Send at most once per screen frame, so the other side sees it live without flooding the link.
  const sendSoon = (fn: () => void) => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      fn();
    });
  };

  /** Anchors a finished drawing to the area it covers, then sends it again with its anchor. */
  const anchor = async (s: Shape, around: Box) => {
    const { anchor, detail } = await anchors.finish(s.id, around);
    if (!anchor) {
      onWeakAnchor?.();
      return;
    }
    onPut?.({ ...s, anchor });
    if (detail < WEAK_ANCHOR) onWeakAnchor?.();
  };

  const startShape = (p: Point, kind: Tool, via?: "hand") => {
    const id = newShapeId(author);
    anchors.begin(id, p);
    if (via) arStats.strokesStarted++;
    drawing.current = { id, author, tool: kind, color: colour, points: [p, p], ...(via && { via }) };
    onPut?.(drawing.current);
  };

  const extendShape = (screen: Point, capturedAt?: number) => {
    const s = drawing.current;
    if (!s) return;
    const p = toAnchored(s.id, screen, anchors.placementsAt(capturedAt));
    s.points = s.tool === "pen" ? [...s.points, p] : [s.points[0], p];
    sendSoon(() => onPut?.({ ...s }));
  };

  const finishShape = () => {
    const s = drawing.current;
    drawing.current = null;
    if (!s) return;
    if (s.via) arStats.strokesEnded++;
    onPut?.({ ...s });
    void anchor(s, bounds(s.points));
  };

  useImperativeHandle(penRef, () => ({
    start: (p) => startShape(p, "pen", "hand"),
    move: extendShape,
    end: finishShape,
    cursor(p) {
      cursor.current = p;
      requestDraw();
    },
    mask: anchors.setMask,
    hand(points) {
      hand.current = points;
      requestDraw();
    },
    rub(at, radius, capturedAt) {
      const v = videoRef.current;
      const aspect = v?.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 1;
      const previous = previousRub.current ?? at;
      const distance = Math.hypot((at[0] - previous[0]) * aspect, at[1] - previous[1]);
      const count = Math.min(20, Math.max(1, Math.ceil(distance / (radius * 0.6))));
      previousRub.current = at;
      return Array.from({ length: count }, (_, i) => {
        const t = (i + 1) / count;
        return eraseChanges(live.current.shapes, anchors.placementsAt(capturedAt), [previous[0] + (at[0] - previous[0]) * t, previous[1] + (at[1] - previous[1]) * t], radius, aspect);
      }).flat();
    },
    endRub() { previousRub.current = null; },
  }));

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tool || tool === "pointer") return;
    const p = toPoint(e);
    if (tool === "text") {
      const rect = canvasRef.current!.getBoundingClientRect();
      setTextAt({ point: p, left: e.clientX - rect.left, top: e.clientY - rect.top });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    startShape(p, tool);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === "pointer") {
      const p = toPoint(e);
      return sendSoon(() => onPointer?.(p));
    }
    extendShape(toPoint(e));
  };

  const up = finishShape;

  const keyboard = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!tool) return;
    const directions: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[e.key];
    if (direction) {
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : 0.02;
      const clamp = (n: number) => Math.min(1, Math.max(0, n));
      const p: Point = [clamp(keyboardPoint.current[0] + direction[0] * step), clamp(keyboardPoint.current[1] + direction[1] * step)];
      keyboardPoint.current = p;
      if (tool === "pointer") onPointer?.(p);
      else if (drawing.current) extendShape(p);
      draw();
    } else if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
      e.preventDefault();
      const p = keyboardPoint.current;
      if (tool === "pointer") onPointer?.(p);
      else if (tool === "text") {
        const b = box();
        setTextAt({ point: p, left: b.x + p[0] * b.w, top: b.y + p[1] * b.h });
      } else if (drawing.current) finishShape();
      else startShape(p, tool);
    }
  };

  const placeText = (text: string) => {
    if (textAt && text.trim()) {
      const s: Shape = { id: newShapeId(author), author, tool: "text", color: colour, points: [textAt.point], text: text.trim().slice(0, 80) };
      anchors.begin(s.id, textAt.point);
      onPut?.(s);
      void anchor(s, { x: textAt.point[0], y: textAt.point[1] - 0.06, w: 0.25, h: 0.08 }); // roughly where the label sits
    }
    setTextAt(null);
  };

  return (
    <div className="relative size-full overflow-hidden bg-black">
      <video ref={videoRef} autoPlay playsInline muted={muted} aria-label={label} className="absolute inset-0 size-full object-contain" />
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => tool === "pointer" && onPointer?.(null)}
        tabIndex={tool ? 0 : -1}
        role="group"
        aria-label="Drawing area. Use arrow keys to move the cursor, and Enter to start or finish a drawing."
        onFocus={() => setKeyboardFocus(true)}
        onBlur={() => { setKeyboardFocus(false); finishShape(); }}
        onKeyDown={keyboard}
        className="absolute inset-0 size-full"
        style={{
          pointerEvents: tool ? "auto" : "none",
          touchAction: tool ? "none" : "auto",
          cursor: tool === "text" ? "text" : tool === "pointer" ? "none" : "crosshair",
        }}
      />
      {anchors.status === "failed" && (
        <p className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-hangar/85 px-2 py-1 text-xs text-dim">
          Drawings will not follow the camera on this device.
        </p>
      )}
      {!onNotice && notice && (
        <p role="status" className="pointer-events-none absolute bottom-2 right-2 max-w-[60%] rounded-md bg-hangar/90 px-3 py-2 text-sm text-white">
          {TRACKING_NOTICE[notice]}
        </p>
      )}
      {anchors.status === "ready" && anchors.limited && (
        <p role="status" className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-hangar/85 px-2 py-1 text-xs text-dim">
          Tracking is slow. Move the camera gently.
        </p>
      )}
      {textAt && (
        <input
          autoFocus
          aria-label="Label text"
          placeholder="Type a label, then press Enter"
          maxLength={80}
          onKeyDown={(e) => {
            if (e.key === "Enter") placeText(e.currentTarget.value);
            if (e.key === "Escape") setTextAt(null);
          }}
          onBlur={(e) => placeText(e.currentTarget.value)}
          className="absolute z-10 w-64 rounded-md border border-blue-bright bg-hangar px-3 py-2 text-white"
          style={{ left: Math.min(textAt.left, (canvasRef.current?.clientWidth ?? 300) - 260), top: textAt.top }}
        />
      )}
      {debug && <ArDebug shapes={shapes} placements={anchors.placements} />}
      {children}
    </div>
  );
}

/** Three bars, measured from the call. Grey when fine; amber or red only when it is not. */
export function SignalBars({ quality }: { quality: Quality | null }) {
  const level = quality?.level;
  const bars = level === "good" ? 3 : level === "fair" ? 2 : level === "poor" ? 1 : 0;
  const on = level === "poor" ? "bg-warn-bright" : level === "fair" ? "bg-caution" : "bg-white/85";
  const label = quality ? `Connection ${level}` : "Measuring connection";
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex h-4 items-end gap-0.5">
      {[1, 2, 3].map((i) => (
        <span key={i} className={`w-1 rounded-sm ${i <= bars ? on : "bg-white/25"}`} style={{ height: `${i * 33}%` }} />
      ))}
    </span>
  );
}
