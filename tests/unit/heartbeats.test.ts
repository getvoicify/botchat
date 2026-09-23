import { test, expect } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { openDatabase } from "../../src/db/schema.ts";
import { Store } from "../../src/db/store.ts";
import { EventBus } from "../../src/core/bus.ts";
import { RoomService } from "../../src/core/rooms.ts";
import { MessageService } from "../../src/core/messages.ts";
import { HeartbeatService } from "../../src/core/heartbeats.ts";
import { PresenceService } from "../../src/core/presence.ts";
import { createSocketHandlers } from "../../src/server/ws.ts";

// A fixed "now" far enough in the future that seeded timestamps can sit on
// either side of the stale/recent windows without colliding with Date.now().
const NOW = 2_000_000_000_000;
const MIN = 60_000;

function fixture() {
  const store = new Store(openDatabase(":memory:"));
  const bus = new EventBus();
  const rooms = new RoomService(store);
  const messages = new MessageService(store, rooms, bus);
  const heartbeats = new HeartbeatService(store, messages, {
    staleMs: 10 * MIN,
    cooldownMs: 30 * MIN,
    intervalMs: 2 * MIN,
    alarmAuthor: "liveness-monitor",
  });
  const room = rooms.create({ name: "test" });
  return { store, bus, rooms, messages, heartbeats, room };
}

function seedActivity(
  store: Store,
  roomId: string,
  entries: { name: string; kind: "human" | "bot"; lastMessageAt: number }[],
): void {
  for (const entry of entries) {
    store.insertParticipant({
      id: crypto.randomUUID(),
      roomId,
      name: entry.name,
      kind: entry.kind,
      joinedAt: NOW - 60 * MIN,
    });
    const participant = store.findParticipantByName(roomId, entry.name)!;
    store.insertMessage({
      roomId,
      participantId: participant.id,
      kind: "text",
      body: `${entry.name} speaks`,
      lang: null,
      createdAt: entry.lastMessageAt,
    });
    store.recordHeartbeat(roomId, entry.name, entry.lastMessageAt);
  }
}

test("a ping refreshes an author's last-seen", () => {
  const { store, messages, bus, heartbeats, room } = fixture();
  const handlers = createSocketHandlers({ messages, bus, heartbeats, presence: new PresenceService() });
  const ws = { data: { roomId: room.id, cursor: 0, lastActivity: 0 } };
  // @ts-expect-error the handler only reads ws.data.roomId
  handlers.message(ws, JSON.stringify({ type: "ping", author: "ada" }));
  expect(store.heartbeat(room.id, "ada")).toEqual({
    lastSeenAt: expect.any(Number),
    lastAlarmAt: null,
  });
});

test("a non-ping message on the socket is ignored", () => {
  const { store, messages, bus, heartbeats, room } = fixture();
  const handlers = createSocketHandlers({ messages, bus, heartbeats, presence: new PresenceService() });
  const ws = { data: { roomId: room.id, cursor: 0, lastActivity: 0 } };
  // @ts-expect-error the handler only reads ws.data.roomId
  handlers.message(ws, "not json at all");
  expect(store.heartbeat(room.id, "ada")).toBeNull();
});

test("posting alone does not declare an agent", () => {
  const { store, messages, room } = fixture();
  messages.post({ roomId: room.id, author: "ada", body: "just one message", authorKind: "bot" });
  expect(store.heartbeat(room.id, "ada")).toBeNull();
});

test("posting refreshes an already-declared agent's last-seen", () => {
  const { store, messages, room } = fixture();
  store.recordHeartbeat(room.id, "ada", 0);
  const before = store.heartbeat(room.id, "ada")!.lastSeenAt;
  messages.post({ roomId: room.id, author: "ada", body: "still here", authorKind: "bot" });
  const after = store.heartbeat(room.id, "ada")!.lastSeenAt;
  expect(after).toBeGreaterThan(before);
});

test("a one-message author who never pings is never alarmed", () => {
  const { store, heartbeats, room } = fixture();
  // api posts once (participant exists) but never sends a ping.
  store.insertParticipant({ id: crypto.randomUUID(), roomId: room.id, name: "api", kind: "bot", joinedAt: NOW - 60 * MIN });
  store.insertMessage({
    roomId: room.id,
    participantId: store.findParticipantByName(room.id, "api")!.id,
    kind: "text",
    body: "stray post",
    lang: null,
    createdAt: NOW - 1 * MIN,
  });
  // A human keeps the room active so the quiet-room exemption does not hide it.
  store.insertParticipant({ id: crypto.randomUUID(), roomId: room.id, name: "tom", kind: "human", joinedAt: NOW - 60 * MIN });
  store.insertMessage({
    roomId: room.id,
    participantId: store.findParticipantByName(room.id, "tom")!.id,
    kind: "text",
    body: "active",
    lang: null,
    createdAt: NOW - 1 * MIN,
  });
  expect(store.heartbeat(room.id, "api")).toBeNull();
  expect(heartbeats.checkNow(NOW)).toBe(0);
});

test("a stale agent in an active room is alarmed once per cooldown", () => {
  const { store, messages, heartbeats, room } = fixture();
  seedActivity(store, room.id, [
    { name: "ada", kind: "bot", lastMessageAt: NOW - 20 * MIN },
    { name: "tom", kind: "human", lastMessageAt: NOW - 1 * MIN },
  ]);

  expect(heartbeats.checkNow(NOW)).toBe(1);
  const alarm = messages.latest(room.id);
  expect(alarm.at(-1)?.author).toBe("liveness-monitor");
  expect(alarm.at(-1)?.body).toContain("ada");

  // A second sweep inside the cooldown does not re-alarm.
  expect(heartbeats.checkNow(NOW + 5 * MIN)).toBe(0);
});

test("a quiet room raises no alarm even when an agent is stale", () => {
  const { store, heartbeats, room } = fixture();
  seedActivity(store, room.id, [{ name: "ada", kind: "bot", lastMessageAt: NOW - 20 * MIN }]);
  expect(heartbeats.checkNow(NOW)).toBe(0);
});

test("a room with heartbeat disabled records nothing and raises no alarm", () => {
  const { store, rooms, heartbeats, room } = fixture();
  rooms.setHeartbeat(room.id, false);
  // The write is dropped because the room is disabled.
  seedActivity(store, room.id, [
    { name: "ada", kind: "bot", lastMessageAt: NOW - 20 * MIN },
    { name: "tom", kind: "human", lastMessageAt: NOW - 1 * MIN },
  ]);
  expect(store.heartbeat(room.id, "ada")).toBeNull();
  expect(heartbeats.checkNow(NOW)).toBe(0);
});

test("an author who never posted is not a registered author", () => {
  const { store, heartbeats, room } = fixture();
  seedActivity(store, room.id, [{ name: "tom", kind: "human", lastMessageAt: NOW - 1 * MIN }]);
  expect(heartbeats.checkNow(NOW)).toBe(0);
});

test("the liveness-monitor itself is never alarmed", () => {
  const { store, heartbeats, room } = fixture();
  seedActivity(store, room.id, [
    { name: "liveness-monitor", kind: "bot", lastMessageAt: NOW - 20 * MIN },
    { name: "tom", kind: "human", lastMessageAt: NOW - 1 * MIN },
  ]);
  expect(heartbeats.checkNow(NOW)).toBe(0);
});

test("backfills heartbeat_enabled onto a rooms table that predates it", () => {
  const path = `${tmpdir()}/botchat-heartbeat-migration-${crypto.randomUUID()}.db`;
  const old = new Database(path, { create: true });
  old.exec(
    "CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, topic TEXT, created_at INTEGER NOT NULL)",
  );
  old.close();

  const db = openDatabase(path);
  const columns = db.query("PRAGMA table_info(rooms)").all() as {
    name: string;
    dflt_value: unknown;
  }[];
  const enabled = columns.find((column) => column.name === "heartbeat_enabled");
  expect(enabled).toBeDefined();
  expect(enabled?.dflt_value).toBe("1");
  db.close();
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
});
