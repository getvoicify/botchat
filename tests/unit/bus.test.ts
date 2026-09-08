import { test, expect } from "bun:test";
import { EventBus } from "../../src/core/bus.ts";

test("delivers an emit to every subscriber of that room", () => {
  const bus = new EventBus();
  const seen: string[] = [];
  bus.subscribe("r1", () => seen.push("a"));
  bus.subscribe("r1", () => seen.push("b"));
  bus.emit("r1");
  expect(seen).toEqual(["a", "b"]);
});

test("does not deliver an emit to subscribers of a different room", () => {
  const bus = new EventBus();
  let called = false;
  bus.subscribe("r1", () => {
    called = true;
  });
  bus.emit("r2");
  expect(called).toBe(false);
});

test("stops delivering to a listener that unsubscribed", () => {
  const bus = new EventBus();
  let calls = 0;
  const off = bus.subscribe("r1", () => {
    calls += 1;
  });
  bus.emit("r1");
  off();
  bus.emit("r1");
  expect(calls).toBe(1);
});

test("forgets a room once its last subscriber leaves", () => {
  const bus = new EventBus();
  const off = bus.subscribe("r1", () => {});
  off();
  expect(bus.listenerCount("r1")).toBe(0);
});

test("survives a listener that unsubscribes itself during an emit", () => {
  const bus = new EventBus();
  const seen: string[] = [];
  const off = bus.subscribe("r1", () => {
    seen.push("self");
    off();
  });
  bus.subscribe("r1", () => seen.push("other"));
  bus.emit("r1");
  expect(seen).toEqual(["self", "other"]);
});

test("resolves once when a message arrives before the timeout", async () => {
  const bus = new EventBus();
  const waiting = bus.once("r1", 5_000);
  bus.emit("r1");
  await waiting;
  expect(bus.listenerCount("r1")).toBe(0);
});

test("resolves after the timeout when nothing arrives", async () => {
  const bus = new EventBus();
  const started = Date.now();
  await bus.once("r1", 30);
  expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  expect(bus.listenerCount("r1")).toBe(0);
});
