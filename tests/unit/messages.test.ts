import { test, expect } from "bun:test";
import { openDatabase } from "../../src/db/schema.ts";
import { Store } from "../../src/db/store.ts";
import { RoomService } from "../../src/core/rooms.ts";
import { MessageService } from "../../src/core/messages.ts";
import { EventBus } from "../../src/core/bus.ts";
import { Invalid, NotFound } from "../../src/core/errors.ts";

function fixture() {
  const store = new Store(openDatabase(":memory:"));
  const bus = new EventBus();
  const rooms = new RoomService(store);
  const messages = new MessageService(store, rooms, bus);
  const room = rooms.create({ name: "test" });
  return { rooms, messages, bus, room };
}

test("returns the appended message with its author and sequence", () => {
  const { messages, room } = fixture();
  const posted = messages.post({ roomId: room.id, author: "tom", body: "hello" });
  expect(posted.seq).toBe(1);
  expect(posted.author).toBe("tom");
  expect(posted.body).toBe("hello");
  expect(posted.kind).toBe("text");
});

test("hands out increasing sequence numbers across rooms", () => {
  const { rooms, messages, room } = fixture();
  const other = rooms.create({ name: "other" });
  messages.post({ roomId: room.id, author: "tom", body: "one" });
  const second = messages.post({ roomId: other.id, author: "tom", body: "two" });
  expect(second.seq).toBe(2);
});

test("returns only messages from the room asked for", () => {
  const { rooms, messages, room } = fixture();
  const other = rooms.create({ name: "other" });
  messages.post({ roomId: room.id, author: "tom", body: "mine" });
  messages.post({ roomId: other.id, author: "tom", body: "theirs" });
  expect(messages.since(room.id, 0).map((m) => m.body)).toEqual(["mine"]);
});

test("returns nothing for a cursor at the newest message", () => {
  const { messages, room } = fixture();
  const posted = messages.post({ roomId: room.id, author: "tom", body: "hello" });
  expect(messages.since(room.id, posted.seq)).toEqual([]);
});

test("reuses the participant row when the same author posts twice", () => {
  const { rooms, messages, room } = fixture();
  messages.post({ roomId: room.id, author: "tom", body: "one" });
  messages.post({ roomId: room.id, author: "tom", body: "two" });
  expect(rooms.participants(room.id)).toHaveLength(1);
});

test("keeps a bot marked as a bot when it posts again", () => {
  const { rooms, messages, room } = fixture();
  rooms.join(room.id, "ada", "bot");
  messages.post({ roomId: room.id, author: "ada", body: "beep" });
  expect(rooms.participants(room.id)[0]!.kind).toBe("bot");
});

test("announces the room on the bus once a message is appended", () => {
  const { messages, bus, room } = fixture();
  let notified = 0;
  bus.subscribe(room.id, () => {
    notified += 1;
  });
  messages.post({ roomId: room.id, author: "tom", body: "hello" });
  expect(notified).toBe(1);
});

test("makes the message readable by the time the bus fires", () => {
  const { messages, bus, room } = fixture();
  let visible: number = -1;
  bus.subscribe(room.id, () => {
    visible = messages.since(room.id, 0).length;
  });
  messages.post({ roomId: room.id, author: "tom", body: "hello" });
  expect(visible).toBe(1);
});

test("rejects a message with a blank body", () => {
  const { messages, room } = fixture();
  expect(() => messages.post({ roomId: room.id, author: "tom", body: "   " })).toThrow(Invalid);
});

test("rejects a message with a blank author", () => {
  const { messages, room } = fixture();
  expect(() => messages.post({ roomId: room.id, author: " ", body: "hi" })).toThrow(Invalid);
});

test("rejects a message posted to a room that does not exist", () => {
  const { messages } = fixture();
  expect(() => messages.post({ roomId: "nope", author: "tom", body: "hi" })).toThrow(NotFound);
});

test("keeps the language of a code message", () => {
  const { messages, room } = fixture();
  const posted = messages.post({
    roomId: room.id,
    author: "tom",
    body: "x = 1",
    kind: "code",
    lang: "python",
  });
  expect(posted.lang).toBe("python");
});

test("drops a language given for a plain text message", () => {
  const { messages, room } = fixture();
  const posted = messages.post({ roomId: room.id, author: "tom", body: "hi", lang: "python" });
  expect(posted.lang).toBeNull();
});

test("returns the newest messages when asked for the latest page", () => {
  const { messages, room } = fixture();
  for (const body of ["a", "b", "c"]) messages.post({ roomId: room.id, author: "tom", body });
  expect(messages.latest(room.id, 2).map((m) => m.body)).toEqual(["b", "c"]);
});

test("returns older messages in reading order when paging backwards", () => {
  const { messages, room } = fixture();
  const posted = ["a", "b", "c"].map((body) => messages.post({ roomId: room.id, author: "tom", body }));
  expect(messages.before(room.id, posted[2]!.seq, 2).map((m) => m.body)).toEqual(["a", "b"]);
});

test("counts only the messages in the room asked for", () => {
  const { rooms, messages, room } = fixture();
  const other = rooms.create({ name: "other" });
  messages.post({ roomId: room.id, author: "tom", body: "mine" });
  messages.post({ roomId: other.id, author: "tom", body: "theirs" });
  expect(messages.count(room.id)).toBe(1);
});
