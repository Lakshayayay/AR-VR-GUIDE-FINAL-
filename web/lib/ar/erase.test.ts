import { test } from "node:test";
import assert from "node:assert/strict";
import { eraseChanges } from "./erase.ts";
import type { Shape, Placements } from "../annotations.ts";

test("rubbing maps the footprint back to each locked drawing's anchor", () => {
  const shape: Shape = { id: "s", author: 1, tool: "pen", color: "#fff", points: [[0.1, 0.5], [0.8, 0.5]], anchor: { img: "x", box: { x: 0, y: 0, w: 1, h: 1 } } };
  const placements: Placements = { s: { h: [1, 0, 0.1, 0, 1, 0, 0, 0, 1], state: "locked" } };
  const result = eraseChanges([shape], placements, [0.6, 0.5], 0.05, 1);
  assert.equal(result.length, 1);
  const xs = result[0].polygon.map((p) => p[0]);
  assert.ok(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - 0.5) < 1e-9);
  assert.deepEqual(eraseChanges([shape], { s: { ...placements.s, state: "searching" } }, [0.6, 0.5], 0.05, 1), []);
  assert.deepEqual(eraseChanges([shape], placements, [0.6, 0.9], 0.05, 1), []);
});
