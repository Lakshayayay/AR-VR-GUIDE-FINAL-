// Drawings on the video. One copy, used by both screens and for photos.
// Points are fractions (0 to 1) of the video picture, so both sides agree whatever their screen size.

export type Tool = "arrow" | "circle" | "rect" | "pen" | "text";
export type Point = [number, number];

export interface Shape {
  id: string;
  author: number;
  tool: Tool;
  color: string;
  points: Point[];
  text?: string;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Inspection-lacquer colours. Green is kept for the technician.
export const EXPERT_COLOURS = [
  { name: "Orange", value: "#FF6A13" },
  { name: "Yellow", value: "#FFD60A" },
  { name: "Pink", value: "#FF3D9A" },
  { name: "White", value: "#FFFFFF" },
];
export const TECH_COLOUR = "#3DDC84";

/** Where a video of size vw x vh sits inside a cw x ch area when letterboxed ("contain"). */
export function contentBox(vw: number, vh: number, cw: number, ch: number): Box {
  if (!vw || !vh) return { x: 0, y: 0, w: cw, h: ch };
  const scale = Math.min(cw / vw, ch / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

export const newShapeId = (author: number) => `${author}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], box: Box, fontFamily: string) {
  const lw = Math.max(3, box.w / 260);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of shapes) {
    const pts = s.points.map(([x, y]) => [box.x + x * box.w, box.y + y * box.h] as Point);
    if (!pts.length) continue;
    if (s.tool === "text") {
      drawLabel(ctx, s.text ?? "", pts[0], s.color, lw, fontFamily);
      continue;
    }
    // A dark edge under every line keeps it visible on bare metal and in sunlight.
    for (const [colour, width] of [["rgba(0,0,0,0.7)", lw + 3], [s.color, lw]] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      outline(ctx, s.tool, pts, lw);
      ctx.stroke();
    }
  }
}

function outline(ctx: CanvasRenderingContext2D, tool: Tool, pts: Point[], lw: number) {
  const a = pts[0];
  const b = pts[pts.length - 1];
  ctx.beginPath();
  if (tool === "pen") {
    ctx.moveTo(...a);
    for (const p of pts.slice(1)) ctx.lineTo(...p);
  } else if (tool === "rect") {
    ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  } else if (tool === "circle") {
    ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
  } else if (tool === "arrow") {
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const head = lw * 5;
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.moveTo(b[0] - head * Math.cos(angle - 0.45), b[1] - head * Math.sin(angle - 0.45));
    ctx.lineTo(...b);
    ctx.lineTo(b[0] - head * Math.cos(angle + 0.45), b[1] - head * Math.sin(angle + 0.45));
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, [x, y]: Point, colour: string, lw: number, fontFamily: string) {
  const size = Math.round(lw * 5.5);
  ctx.font = `700 ${size}px ${fontFamily}`;
  const pad = size * 0.35;
  const width = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(x - pad, y - size - pad / 2, width + pad * 2, size + pad * 1.5);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

export function drawPointer(ctx: CanvasRenderingContext2D, [x, y]: Point, box: Box) {
  const px = box.x + x * box.w;
  const py = box.y + y * box.h;
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.arc(px, py, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#2AA7D8";
  ctx.stroke();
  ctx.fillStyle = "#2AA7D8";
  ctx.beginPath();
  ctx.arc(px, py, 4, 0, Math.PI * 2);
  ctx.fill();
}

/** A still of the video with the drawings on top, at the camera's full size. */
export function capture(video: HTMLVideoElement, shapes: Shape[], fontFamily: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0);
  drawShapes(ctx, shapes, { x: 0, y: 0, w: canvas.width, h: canvas.height }, fontFamily);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No picture yet"))), "image/jpeg", 0.9),
  );
}
