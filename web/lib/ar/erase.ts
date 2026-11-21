import { mapPoint, project, type EraseChange, type Placements, type Point, type Shape } from "../annotations.ts";
import { invertH } from "./anchor-core.ts";

/** Turn a palm footprint into polygons in the reference coordinates of visible, locked drawings. */
export function eraseChanges(shapes: Shape[], placements: Placements, at: Point, radius: number, aspect: number): EraseChange[] {
  if (!(radius > 0) || !(aspect > 0)) return [];
  const polygon: Point[] = Array.from({ length: 16 }, (_, i) => {
    const angle = i * Math.PI / 8;
    return [at[0] + Math.cos(angle) * radius / aspect, at[1] + Math.sin(angle) * radius];
  });
  const result: EraseChange[] = [];
  for (const shape of shapes) {
    const placement = placements[shape.id];
    if (!shape.anchor || !placement || placement.state !== "locked" || !shape.points.length) continue;
    const points = project(shape, placement.h);
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const labelWidth = shape.tool === "text" ? 0.25 : 0;
    const labelHeight = shape.tool === "text" ? 0.08 : 0;
    if (at[0] + radius / aspect < Math.min(...xs) || at[0] - radius / aspect > Math.max(...xs) + labelWidth ||
        at[1] + radius < Math.min(...ys) - labelHeight || at[1] - radius > Math.max(...ys)) continue;
    const mapped = polygon.map((p) => mapPoint(invertH(placement.h), p));
    if (mapped.every((p) => p.every((v) => Number.isFinite(v) && Math.abs(v) <= 4))) result.push({ id: shape.id, polygon: mapped });
  }
  return result;
}
