import { test, expect } from "bun:test";
import { PresenceService } from "../../src/core/presence.ts";

test("lists an author as thinking once marked", () => {
  const presence = new PresenceService(60_000);
  presence.setThinking("r1", "ada");
  expect(presence.snapshot("r1")).toEqual(["ada"]);
});

test("does not list an author in a different room", () => {
  const presence = new PresenceService(60_000);
  presence.setThinking("r1", "ada");
  expect(presence.snapshot("r2")).toEqual([]);
});

test("removes an author once cleared", () => {
  const presence = new PresenceService(60_000);
  presence.setThinking("r1", "ada");
  presence.clear("r1", "ada");
  expect(presence.snapshot("r1")).toEqual([]);
});

test("clearing an author who was never marked is a no-op", () => {
  const presence = new PresenceService(60_000);
  expect(() => presence.clear("r1", "ada")).not.toThrow();
  expect(presence.snapshot("r1")).toEqual([]);
});

test("expires an author automatically after the TTL", async () => {
  const presence = new PresenceService(20);
  presence.setThinking("r1", "ada");
  expect(presence.snapshot("r1")).toEqual(["ada"]);
  await Bun.sleep(40);
  expect(presence.snapshot("r1")).toEqual([]);
});

test("renewing before expiry keeps the author past the original TTL", async () => {
  const presence = new PresenceService(30);
  presence.setThinking("r1", "ada");
  await Bun.sleep(20);
  presence.setThinking("r1", "ada");
  await Bun.sleep(20);
  expect(presence.snapshot("r1")).toEqual(["ada"]);
  await Bun.sleep(20);
  expect(presence.snapshot("r1")).toEqual([]);
});

test("notifies a room's subscriber with the current snapshot when someone starts thinking", () => {
  const presence = new PresenceService(60_000);
  const seen: string[][] = [];
  presence.subscribe("r1", (authors) => seen.push(authors));
  presence.setThinking("r1", "ada");
  expect(seen).toEqual([["ada"]]);
});

test("notifies a room's subscriber with the current snapshot when someone stops thinking", () => {
  const presence = new PresenceService(60_000);
  presence.setThinking("r1", "ada");
  const seen: string[][] = [];
  presence.subscribe("r1", (authors) => seen.push(authors));
  presence.clear("r1", "ada");
  expect(seen).toEqual([[]]);
});

test("does not notify a subscriber of a different room", () => {
  const presence = new PresenceService(60_000);
  let called = false;
  presence.subscribe("r2", () => {
    called = true;
  });
  presence.setThinking("r1", "ada");
  expect(called).toBe(false);
});

test("stops notifying a listener that unsubscribed", () => {
  const presence = new PresenceService(60_000);
  let calls = 0;
  const off = presence.subscribe("r1", () => {
    calls += 1;
  });
  presence.setThinking("r1", "ada");
  off();
  presence.setThinking("r1", "bo");
  expect(calls).toBe(1);
});

test("clearing an unmarked author does not notify subscribers", () => {
  const presence = new PresenceService(60_000);
  let calls = 0;
  presence.subscribe("r1", () => {
    calls += 1;
  });
  presence.clear("r1", "ada");
  expect(calls).toBe(0);
});

// Every listener here is a `ws.send`, and a socket can close between two
// iterations of the fan-out. The same two guards as EventBus.emit.
test("still reaches the other subscribers when one of them throws", () => {
  const presence = new PresenceService(60_000);
  let reached = 0;
  presence.subscribe("r1", () => {
    throw new Error("boom");
  });
  presence.subscribe("r1", () => {
    reached += 1;
  });
  expect(() => presence.setThinking("r1", "ada")).not.toThrow();
  expect(reached).toBe(1);
});

test("does not call a subscriber that an earlier one unsubscribed", () => {
  const presence = new PresenceService(60_000);
  let calls = 0;
  let off = () => {};
  presence.subscribe("r1", () => off());
  off = presence.subscribe("r1", () => {
    calls += 1;
  });
  presence.setThinking("r1", "ada");
  expect(calls).toBe(0);
});
