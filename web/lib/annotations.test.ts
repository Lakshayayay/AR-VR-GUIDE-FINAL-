import { test } from "node:test";
import assert from "node:assert/strict";
import { project, smooth, applyErase, undoErase, type Shape } from "./annotations.ts";

const shape = (tool: Shape["tool"], points: [number, number][]): Shape => ({ id: "s", author: 1, tool, color: "#fff", points });
const close = (a: number[][], b: number[][]) => a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9);

test("partial erasing preserves the original drawing and undo restores just that operation", () => {
  const s = shape("pen", [[0.1, 0.5], [0.9, 0.5]]);
  const a: [number, number][] = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6]];
  const b: [number, number][] = [[0.7, 0.4], [0.8, 0.4], [0.8, 0.6]];
  const erased = applyErase({ s }, "one", [{ id: "s", polygon: a }]);
  const twice = applyErase(erased, "two", [{ id: "s", polygon: b }]);
  assert.deepEqual(twice.s.points, s.points);
  assert.deepEqual(undoErase(twice, "one").s.erasures, { two: [b] });
});

test("a box is drawn as its four corners", () => {
  assert.deepEqual(project(shape("rect", [[0.1, 0.2], [0.3, 0.4]])), [[0.1, 0.2], [0.3, 0.2], [0.3, 0.4], [0.1, 0.4]]);
});

test("a placement moves every point of a pen line", () => {
  const moved = project(shape("pen", [[0.1, 0.1], [0.2, 0.3]]), [1, 0, 0.1, 0, 1, -0.05, 0, 0, 1]);
  assert.ok(close(moved, [[0.2, 0.05], [0.3, 0.25]]), JSON.stringify(moved));
});

test("a turned box stays a true box, not the axis-aligned box of its corners", () => {
  const a = Math.PI / 2; // quarter turn about the origin
  const turned = project(shape("rect", [[0.1, 0.1], [0.3, 0.2]]), [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1]);
  assert.ok(close(turned, [[-0.1, 0.1], [-0.1, 0.3], [-0.2, 0.3], [-0.2, 0.1]]), JSON.stringify(turned));
});

test("a circle is drawn as points around its ellipse", () => {
  const pts = project(shape("circle", [[0.1, 0.2], [0.3, 0.4]]));
  assert.ok(pts.length >= 32);
  for (const [x, y] of pts) assert.ok(Math.abs(Math.hypot(x - 0.2, y - 0.3) - 0.1) < 1e-9);
});

test("a pen line is smoothed by curving each corner between the midpoints on either side", () => {
  const A: [number, number] = [0, 0], B: [number, number] = [0.2, 0], C: [number, number] = [0.2, 0.2], D: [number, number] = [0.4, 0.2];
  assert.ok(close(smooth([A, B, C, D]).flat(), [B, [0.2, 0.1], C, [0.3, 0.2]]), JSON.stringify(smooth([A, B, C, D])));
  assert.deepEqual(smooth([A, B]), [], "two points are just a straight line");
  assert.deepEqual(smooth([A]), []);
});
