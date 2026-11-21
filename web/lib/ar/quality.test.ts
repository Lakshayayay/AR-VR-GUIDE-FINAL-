import { test } from "node:test";
import assert from "node:assert/strict";
import { holdLost, nearest, trackingNotice, trackingQuality } from "./quality.ts";

test("slow tracking lowers analysis size after three seconds without queuing frames", () => {
  const q = trackingQuality();
  for (let t = 0; t <= 3000; t += 50) q.frame(t);
  assert.equal(q.size(), 480);
  assert.equal(q.limited(), false);
  for (let t = 3050; t <= 6100; t += 50) q.frame(t);
  assert.equal(q.limited(), true);
});

test("a 30 fps tracking stream retains the detailed analysis size", () => {
  const q = trackingQuality();
  for (let i = 0; i <= 120; i++) q.frame(i * 1000 / 30);
  assert.equal(q.size(), 640);
  assert.equal(q.limited(), false);
});

test("the tracked picture nearest in time is the one the hand was seen in", () => {
  const log = [{ capturedAt: 10 }, { capturedAt: 20 }, { capturedAt: 30 }];
  assert.equal(nearest(log, 24)?.capturedAt, 20);
  assert.equal(nearest(log, 26)?.capturedAt, 30);
  assert.equal(nearest(log, 1000)?.capturedAt, 30);
  assert.equal(nearest([], 5), undefined);
});

const at = (state: "locked" | "fixed" | "searching") => ({ a: { h: [1, 0, 0, 0, 1, 0, 0, 0, 1], state } });

test("a drawing lost for a moment is held solid, then shown as lost", () => {
  const lostAt = new Map<string, number>();
  assert.equal(holdLost(at("locked"), lostAt, 0).a.state, "locked");
  assert.equal(holdLost(at("searching"), lostAt, 100).a.state, "holding");
  assert.equal(holdLost(at("searching"), lostAt, 599).a.state, "holding");
  assert.equal(holdLost(at("searching"), lostAt, 601).a.state, "searching");
  assert.equal(holdLost(at("locked"), lostAt, 700).a.state, "locked");
  assert.equal(holdLost(at("searching"), lostAt, 800).a.state, "holding", "a new loss gets its own half second");
});

test("drawings that are gone are forgotten", () => {
  const lostAt = new Map<string, number>();
  holdLost(at("searching"), lostAt, 0);
  holdLost({}, lostAt, 10);
  assert.equal(lostAt.size, 0);
});

test("a tracker with time to spare moves up to a larger size, and back down when it slows, for good", () => {
  const q = trackingQuality();
  let t = 0;
  const run = (frames: number, perSecond: number, ms: number) => {
    for (let i = 0; i < frames; i++) q.frame((t += 1000 / perSecond), ms);
  };
  run(100, 30, 8); // 30 a second, 8 ms each: plenty of time to spare
  assert.equal(q.size(), 960);
  run(70, 20, 40); // now 20 a second: too much for this phone
  assert.equal(q.size(), 640);
  run(200, 30, 8); // fast again, but 960 was too much
  assert.equal(q.size(), 640);
});

test("without timings the size only ever goes down", () => {
  const q = trackingQuality();
  for (let i = 0; i <= 300; i++) q.frame((i * 100) / 3);
  assert.equal(q.size(), 640);
});

test("a drawing with nothing to hold on to stays as it is: solid, with no countdown", () => {
  const lostAt = new Map<string, number>();
  assert.equal(holdLost(at("fixed"), lostAt, 0).a.state, "fixed");
  assert.equal(holdLost(at("fixed"), lostAt, 9000).a.state, "fixed");
  assert.equal(lostAt.size, 0);
});

test("what to tell the user depends on the drawings' states: lost first, then fixed, otherwise nothing", () => {
  const h = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.equal(trackingNotice({}), "");
  assert.equal(trackingNotice({ a: { h, state: "locked" }, b: { h, state: "holding" } }), "");
  assert.equal(trackingNotice({ a: { h, state: "fixed" }, b: { h, state: "locked" } }), "fixed");
  assert.equal(trackingNotice({ a: { h, state: "fixed" }, b: { h, state: "searching" } }), "lost");
});
