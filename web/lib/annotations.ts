// Drawings on the video. One copy, used by both screens and for photos.
// Points are fractions (0 to 1) of the video picture they were drawn on, so both sides agree whatever
// their screen size. A drawing with an anchor is shown through its placement: where that picture's
// area is in the live video now (see lib/ar/anchor-core.ts), so it stays on the part as the camera moves.

export type Tool = "arrow" | "circle" | "rect" | "pen" | "text";
export type Point = [number, number];

/** A small grey JPEG of the area under a drawing, and where it was (fractions). Sent once with the drawing. */
export interface AnchorWire {
  img: string; // data: URL
  box: Box;
  exclude?: Box;
  focus?: Box; // the drawing's own area: its anchor looks for features here first
}

export interface Shape {
  id: string;
  author: number;
  tool: Tool;
  color: string;
  points: Point[];
  text?: string;
  anchor?: AnchorWire;
  via?: "hand"; // drawn by pinching in the air
  erasures?: Record<string, Point[][]>; // cutouts in this drawing's anchor coordinates, grouped by action
}

export type EraseChange = { id: string; polygon: Point[] };

export function applyErase(shapes: Record<string, Shape>, opId: string, changes: EraseChange[]): Record<string, Shape> {
  const next = { ...shapes };
  for (const { id, polygon } of changes) {
    const s = next[id];
    if (!s) continue;
    const masks = s.erasures ?? {};
    next[id] = { ...s, erasures: { ...masks, [opId]: [...(masks[opId] ?? []), polygon] } };
  }
  return next;
}

export function undoErase(shapes: Record<string, Shape>, opId: string): Record<string, Shape> {
  const next = { ...shapes };
  for (const [id, s] of Object.entries(shapes)) {
    if (!s.erasures?.[opId]) continue;
    const { [opId]: _removed, ...erasures } = s.erasures;
    next[id] = { ...s, erasures };
  }
  return next;
}

/** Where a drawing is now: `h` maps its points to the live picture (fractions, 3x3 row by row). */
export interface Placement {
  h: number[];
  state: "locked" | "holding" | "fixed" | "searching"; // holding: just lost, still drawn solid for a moment; fixed: nothing to hold on to here, stays where drawn
}
export type Placements = Record<string, Placement>;

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

export function mapPoint(h: number[] | undefined, [x, y]: Point): Point {
  if (!h) return [x, y];
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** The smallest box around a drawing's points (fractions). */
export function bounds(points: Point[]): Box {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * A drawing's outline in the live picture (fractions). Boxes and circles become corner and edge
 * points first, so they turn and tilt with the surface instead of staying square to the screen.
 */
export function project(s: Shape, h?: number[]): Point[] {
  const [a, b] = [s.points[0], s.points[s.points.length - 1]];
  let pts = s.points;
  if (s.tool === "rect") pts = [a, [b[0], a[1]], b, [a[0], b[1]]];
  if (s.tool === "circle") {
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2;
    pts = Array.from({ length: 48 }, (_, i) => [cx + rx * Math.cos((i / 48) * 2 * Math.PI), cy + ry * Math.sin((i / 48) * 2 * Math.PI)] as Point);
  }
  return pts.map((p) => mapPoint(h, p));
}

const eraseLayers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], box: Box, fontFamily: string, placements: Placements = {}) {
  const lw = Math.max(3, box.w / 260);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of shapes) {
    if (!s.points.length) continue;
    const placed = placements[s.id];
    const pts = project(s, placed?.h).map(([x, y]) => [box.x + x * box.w, box.y + y * box.h] as Point);
    const masks = Object.values(s.erasures ?? {}).flat();
    let layer: HTMLCanvasElement | null = null;
    let target = ctx;
    if (masks.length) {
      layer = eraseLayers.get(ctx.canvas) ?? ctx.canvas.ownerDocument.createElement("canvas");
      eraseLayers.set(ctx.canvas, layer);
      if (layer.width !== ctx.canvas.width || layer.height !== ctx.canvas.height) {
        layer.width = ctx.canvas.width;
        layer.height = ctx.canvas.height;
      }
      target = layer.getContext("2d")!;
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.clearRect(0, 0, layer.width, layer.height);
      target.setTransform(ctx.getTransform());
      target.lineCap = "round";
      target.lineJoin = "round";
    }
    target.save();
    if (placed?.state === "searching") {
      // The part is out of view: show where it was, faded and dashed, so nobody mistakes it for live.
      target.globalAlpha = 0.45;
      target.setLineDash([lw * 3, lw * 2.5]);
    }
    if (s.tool === "text") {
      drawLabel(target, s.text ?? "", pts[0], s.color, lw, fontFamily);
    } else {
      // A dark edge under every line keeps it visible on bare metal and in sunlight.
      for (const [colour, width] of [["rgba(0,0,0,0.7)", lw + 3], [s.color, lw]] as const) {
        target.strokeStyle = colour;
        target.lineWidth = width;
        outline(target, s.tool, pts, lw);
        target.stroke();
      }
    }
    target.restore();
    if (layer) {
      // Erase the union of the footprints from this isolated drawing, never the video or other shapes.
      target.save();
      target.globalCompositeOperation = "destination-out";
      target.beginPath();
      for (const polygon of masks) {
        if (polygon.length < 3) continue;
        const hole = polygon.map((p) => mapPoint(placed?.h, p)).map(([x, y]) => [box.x + x * box.w, box.y + y * box.h] as Point);
        if (!hole.every((p) => p.every(Number.isFinite))) continue;
        target.moveTo(...hole[0]);
        for (const point of hole.slice(1)) target.lineTo(...point);
        target.closePath();
      }
      target.fill();
      target.restore();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    }
  }
}

/**
 * The curved part of a pen line, as [control, end] pairs for `quadraticCurveTo`: every point between the
 * first and last is a corner rounded off between the midpoints on either side. Hand drawing gives few
 * points a second, so without this a line looks angular. Display only: the stored points do not change.
 */
export function smooth(pts: Point[]): [Point, Point][] {
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return pts.slice(1, -1).map((p, i) => [p, mid(p, pts[i + 2])]);
}

function outline(ctx: CanvasRenderingContext2D, tool: Tool, pts: Point[], lw: number) {
  ctx.beginPath();
  ctx.moveTo(...pts[0]);
  if (tool === "pen" && pts.length > 2) {
    ctx.lineTo(...([(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2] as Point));
    for (const [control, end] of smooth(pts)) ctx.quadraticCurveTo(...control, ...end);
    ctx.lineTo(...pts[pts.length - 1]);
  } else for (const p of pts.slice(1)) ctx.lineTo(...p);
  if (tool === "rect" || tool === "circle") ctx.closePath();
  if (tool === "arrow") {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const head = lw * 5;
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

export function drawPointer(ctx: CanvasRenderingContext2D, [x, y]: Point, box: Box, colour = "#2AA7D8") {
  const px = box.x + x * box.w;
  const py = box.y + y * box.h;
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.arc(px, py, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(px, py, 4, 0, Math.PI * 2);
  ctx.fill();
}

/** Capture the same composited frame and placements shown to the participant. */
export function capture(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No picture yet"))), "image/jpeg", 0.9),
  );
}
