"use client";

import { useEffect, useRef, useState } from "react";
import { contentBox, drawPointer, drawShapes, newShapeId, type Point, type Shape, type Tool } from "@/lib/annotations";
import type { Quality } from "@/lib/webrtc";

/** Video with the drawing layer on top. Both screens use it. */
export function Stage({
  videoRef, stream, muted, frozen, shapes, pointer, tool, colour, author, onPut, onPointer, label, children,
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
  label: string;
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Shape | null>(null);
  const frame = useRef(0);
  const [textAt, setTextAt] = useState<{ point: Point; left: number; top: number } | null>(null);
  const [, setSize] = useState(0);

  useEffect(() => {
    const v = videoRef.current;
    if (v && v.srcObject !== stream) v.srcObject = stream;
  }, [stream, videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (frozen) v.pause();
    else void v.play().catch(() => {});
  }, [frozen, stream, videoRef]);

  // Redraw when the drawings change, the window resizes, or the video size becomes known.
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

  const box = () => {
    const canvas = canvasRef.current!;
    const v = videoRef.current;
    return contentBox(v?.videoWidth ?? 0, v?.videoHeight ?? 0, canvas.clientWidth, canvas.clientHeight);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const b = box();
    drawShapes(ctx, shapes, b, getComputedStyle(canvas).fontFamily);
    if (pointer) drawPointer(ctx, pointer, b);
  });

  const toPoint = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const b = box();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return [clamp((e.clientX - rect.left - b.x) / b.w), clamp((e.clientY - rect.top - b.y) / b.h)];
  };

  // Send at most once per screen frame, so the other side sees it live without flooding the link.
  const sendSoon = (fn: () => void) => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      fn();
    });
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tool || tool === "pointer") return;
    const p = toPoint(e);
    if (tool === "text") {
      const rect = canvasRef.current!.getBoundingClientRect();
      setTextAt({ point: p, left: e.clientX - rect.left, top: e.clientY - rect.top });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { id: newShapeId(author), author, tool, color: colour, points: [p, p] };
    onPut?.(drawing.current);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === "pointer") {
      const p = toPoint(e);
      return sendSoon(() => onPointer?.(p));
    }
    const s = drawing.current;
    if (!s) return;
    const p = toPoint(e);
    s.points = s.tool === "pen" ? [...s.points, p] : [s.points[0], p];
    sendSoon(() => onPut?.({ ...s }));
  };

  const up = () => {
    if (drawing.current) onPut?.({ ...drawing.current });
    drawing.current = null;
  };

  const placeText = (text: string) => {
    if (textAt && text.trim()) {
      onPut?.({ id: newShapeId(author), author, tool: "text", color: colour, points: [textAt.point], text: text.trim().slice(0, 80) });
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
        className="absolute inset-0 size-full"
        style={{
          pointerEvents: tool ? "auto" : "none",
          touchAction: tool ? "none" : "auto",
          cursor: tool === "text" ? "text" : tool === "pointer" ? "none" : "crosshair",
        }}
      />
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
