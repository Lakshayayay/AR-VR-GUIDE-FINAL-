import { test } from "node:test";
import assert from "node:assert/strict";
import { drawingLifetime } from "./drawing-lifetime.ts";

test("removed and cleared drawings cannot be restored by late updates", () => {
  const drawings = drawingLifetime();
  assert.equal(drawings.put("a"), true);
  assert.equal(drawings.put("a"), true);
  drawings.remove("a");
  assert.equal(drawings.put("a"), false);
  assert.equal(drawings.put("b"), true);
  drawings.clear();
  assert.equal(drawings.put("b"), false);
  assert.equal(drawings.put("c"), true);
});

test("rejoining makes missing drawings retired and keeps present drawings editable", () => {
  const drawings = drawingLifetime();
  drawings.put("a");
  drawings.put("b");
  drawings.reconcile(["b", "c"]);
  assert.equal(drawings.put("a"), false);
  assert.equal(drawings.put("b"), true);
  assert.equal(drawings.put("c"), true);
});
