import { test, expect } from "bun:test";
import { openDatabase } from "../../src/db/schema.ts";
import { Store } from "../../src/db/store.ts";
import { RoomService } from "../../src/core/rooms.ts";
import { MessageService } from "../../src/core/messages.ts";
import { MemoryService } from "../../src/core/memories.ts";
import { EventBus } from "../../src/core/bus.ts";
import { digest } from "../../src/core/summary.ts";

function busyRoom(count: number) {
  const store = new Store(openDatabase(":memory:"));
  const rooms = new RoomService(store);
  const messages = new MessageService(store, rooms, new EventBus());
  const memories = new MemoryService(store, rooms);
  const room = rooms.create({ name: "release planning", topic: "cut 2.0" });
  for (let i = 1; i <= count; i += 1) {
    messages.post({ roomId: room.id, author: i % 2 ? "tom" : "ada", body: `message ${i}` });
  }
  return { store, rooms, messages, memories, room };
}

test("counts what each participant has said", () => {
  const { room, ...deps } = busyRoom(10);
  const { text } = digest(deps, room.id);
  expect(text).toMatch(/tom.*5/);
  expect(text).toMatch(/ada.*5/);
});

test("lists a participant who has said nothing among who is here", () => {
  const { room, ...deps } = busyRoom(4);
  deps.rooms.join(room.id, "scribe", "bot");
  expect(digest(deps, room.id).text).toContain("scribe (bot): 0 messages");
});

test("reports the total number of messages in the room", () => {
  const { room, ...deps } = busyRoom(40);
  expect(digest(deps, room.id).text).toContain("40");
});

test("quotes the opening of the conversation", () => {
  const { room, ...deps } = busyRoom(40);
  expect(digest(deps, room.id).text).toContain("message 1");
});

test("quotes the most recent exchange", () => {
  const { room, ...deps } = busyRoom(40);
  expect(digest(deps, room.id).text).toContain("message 40");
});

test("leaves out the middle of a long conversation", () => {
  const { room, ...deps } = busyRoom(40);
  expect(digest(deps, room.id).text).not.toContain("message 20");
});

test("says how to read the part it left out", () => {
  const { room, ...deps } = busyRoom(40);
  expect(digest(deps, room.id).text).toContain("get_messages");
});

test("hands back a cursor at the newest message", () => {
  const { room, ...deps } = busyRoom(40);
  expect(digest(deps, room.id).cursor).toBe(40);
});

test("includes the whole conversation when it is short enough to fit", () => {
  const { room, ...deps } = busyRoom(6);
  const { text } = digest(deps, room.id);
  for (let i = 1; i <= 6; i += 1) expect(text).toContain(`message ${i}`);
});

test("describes an empty room as empty rather than failing", () => {
  const store = new Store(openDatabase(":memory:"));
  const rooms = new RoomService(store);
  const messages = new MessageService(store, rooms, new EventBus());
  const memories = new MemoryService(store, rooms);
  const room = rooms.create({ name: "silent" });
  const { text, cursor } = digest({ store, rooms, messages, memories }, room.id);
  expect(cursor).toBe(0);
  expect(text).toMatch(/no messages yet/i);
});

test("tells a joining bot what this room has already decided matters", () => {
  const { room, ...deps } = busyRoom(40);
  deps.memories.pin({
    roomId: room.id,
    author: "scribe",
    messageSeqs: [20],
    note: "the ship date nobody may move",
  });
  const { text } = digest(deps, room.id);
  expect(text).toContain("the ship date nobody may move");
  expect(text).toContain("#20");
});

test("leaves an unpinned memory out of what a joining bot is told", () => {
  const { room, ...deps } = busyRoom(40);
  const args = { roomId: room.id, author: "scribe", messageSeqs: [20] };
  deps.memories.pin({ ...args, note: "the ship date nobody may move" });
  const reversed = deps.memories.pin({ ...args, note: "the ship date we abandoned" });

  deps.memories.unpin(reversed.id);

  const { text } = digest(deps, room.id);
  expect(text).toContain("the ship date nobody may move");
  expect(text).not.toContain("we abandoned");
});

test("says nothing about memories in a room where nothing has been pinned", () => {
  const { room, ...deps } = busyRoom(40);
  expect(digest(deps, room.id).text).not.toMatch(/pinned/i);
});
