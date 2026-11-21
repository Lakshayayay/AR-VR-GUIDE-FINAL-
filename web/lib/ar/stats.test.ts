import assert from "node:assert/strict";
import { test } from "node:test";
import { meter } from "./stats.ts";

test("a meter counts events in the last second", () => {
  const m = meter();
  for (let t = 0; t < 1000; t += 100) m.tick(t); // 10 events, one every 100 ms
  assert.equal(m.perSecond(900), 10);
  assert.equal(m.perSecond(1450), 5); // the first five have aged out
});

test("a meter that stopped receiving events reads zero", () => {
  const m = meter();
  m.tick(0);
  m.tick(100);
  assert.equal(m.perSecond(5000), 0);
});
