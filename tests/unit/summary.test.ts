import { test, expect } from "bun:test";
import { openDatabase } from "../../src/db/schema.ts";
import { Store } from "../../src/db/store.ts";
import { RoomService } from "../../src/core/rooms.ts";
import { MessageService } from "../../src/core/messages.ts";
import { EventBus } from "../../src/core/bus.ts";
import { digest } from "../../src/core/summary.ts";

function busyRoom(count: number) {
  const store = new Store(openDatabase(":memory:"));
  const rooms = new RoomService(store);
  const messages = new MessageService(store, rooms, new EventBus());
  const room = rooms.create({ name: "release planning", topic: "cut 2.0" });
  for (let i = 1; i <= count; i += 1) {
    messages.post({ roomId: room.id, author: i % 2 ? "tom" : "ada", body: `message ${i}` });
  }
  return { store, rooms, messages, room };
}

test("counts what each participant has said", () => {
  const { store, rooms, messages, room } = busyRoom(10);
  const { text } = digest({ store, rooms, messages }, room.id);
  expect(text).toMatch(/tom.*5/);
  expect(text).toMatch(/ada.*5/);
});

test("reports the total number of messages in the room", () => {
  const { store, rooms, messages, room } = busyRoom(40);
  expect(digest({ store, rooms, messages }, room.id).text).toContain("40");
});

test("quotes the opening of the conversation", () => {
  const { store, rooms, messages, room } = busyRoom(40);
  expect(digest({ store, rooms, messages }, room.id).text).toContain("message 1");
});

test("quotes the most recent exchange", () => {
  const { store, rooms, messages, room } = busyRoom(40);
  expect(digest({ store, rooms, messages }, room.id).text).toContain("message 40");
});

test("leaves out the middle of a long conversation", () => {
  const { store, rooms, messages, room } = busyRoom(40);
  expect(digest({ store, rooms, messages }, room.id).text).not.toContain("message 20");
});

test("says how to read the part it left out", () => {
  const { store, rooms, messages, room } = busyRoom(40);
  expect(digest({ store, rooms, messages }, room.id).text).toContain("get_messages");
});

test("hands back a cursor at the newest message", () => {
  const { store, rooms, messages, room } = busyRoom(40);
  expect(digest({ store, rooms, messages }, room.id).cursor).toBe(40);
});

test("includes the whole conversation when it is short enough to fit", () => {
  const { store, rooms, messages, room } = busyRoom(6);
  const { text } = digest({ store, rooms, messages }, room.id);
  for (let i = 1; i <= 6; i += 1) expect(text).toContain(`message ${i}`);
});

test("describes an empty room as empty rather than failing", () => {
  const store = new Store(openDatabase(":memory:"));
  const rooms = new RoomService(store);
  const messages = new MessageService(store, rooms, new EventBus());
  const room = rooms.create({ name: "silent" });
  const { text, cursor } = digest({ store, rooms, messages }, room.id);
  expect(cursor).toBe(0);
  expect(text).toMatch(/no messages yet/i);
});
