import { test, expect, spyOn } from "bun:test";
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
  return { store, rooms, messages, bus, room };
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
  const { store, messages, bus, room } = fixture();
  const observed: { inTransaction: boolean; visible: number }[] = [];
  bus.subscribe(room.id, () => {
    observed.push({
      inTransaction: store.db.inTransaction,
      visible: messages.since(room.id, 0).length,
    });
  });
  messages.post({ roomId: room.id, author: "tom", body: "hello" });
  expect(observed).toEqual([{ inTransaction: false, visible: 1 }]);
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

const DEFAULT_PAGE = 200;

const fill = (post: (body: string) => unknown, count: number) => {
  for (let i = 0; i < count; i += 1) post(`m${i}`);
};

test("raises NotFound when paging forwards through a room that does not exist", () => {
  const { messages } = fixture();
  expect(() => messages.since("nope", 0)).toThrow(NotFound);
});

test("raises NotFound when asking for the latest page of a room that does not exist", () => {
  const { messages } = fixture();
  expect(() => messages.latest("nope")).toThrow(NotFound);
});

test("raises NotFound when paging backwards through a room that does not exist", () => {
  const { messages } = fixture();
  expect(() => messages.before("nope", 10)).toThrow(NotFound);
});

test("raises NotFound when counting a room that does not exist", () => {
  const { messages } = fixture();
  expect(() => messages.count("nope")).toThrow(NotFound);
});

test("refuses a negative limit rather than reading the whole room", () => {
  const { messages, room } = fixture();
  fill((body) => messages.post({ roomId: room.id, author: "tom", body }), DEFAULT_PAGE + 5);
  expect(messages.since(room.id, 0)).toHaveLength(DEFAULT_PAGE);
  expect(() => messages.since(room.id, 0, -1)).toThrow(Invalid);
});

test("refuses a limit of zero", () => {
  const { messages, room } = fixture();
  expect(() => messages.latest(room.id, 0)).toThrow(Invalid);
});

test("refuses a fractional limit", () => {
  const { messages, room } = fixture();
  expect(() => messages.latest(room.id, 1.5)).toThrow(Invalid);
});

test("refuses a limit that is not a number at all", () => {
  const { messages, room } = fixture();
  expect(() => messages.latest(room.id, Number.NaN)).toThrow(Invalid);
});

test("caps a limit larger than the maximum page instead of reading everything", () => {
  const { messages, room } = fixture();
  fill((body) => messages.post({ roomId: room.id, author: "tom", body }), 505);
  expect(messages.latest(room.id, 10_000)).toHaveLength(500);
});

test("refuses a negative cursor when paging forwards", () => {
  const { messages, room } = fixture();
  expect(() => messages.since(room.id, -1)).toThrow(Invalid);
});

test("refuses a fractional cursor when paging backwards", () => {
  const { messages, room } = fixture();
  expect(() => messages.before(room.id, 2.5)).toThrow(Invalid);
});

test("refuses a body that is not text rather than failing on trim", () => {
  const { messages, room } = fixture();
  expect(() =>
    messages.post({ roomId: room.id, author: "tom", body: 42 as unknown as string }),
  ).toThrow(Invalid);
});

test("refuses an author that is not text rather than failing on trim", () => {
  const { messages, room } = fixture();
  expect(() =>
    messages.post({ roomId: room.id, author: 42 as unknown as string, body: "hi" }),
  ).toThrow(Invalid);
});

test("refuses an author kind the schema would reject", () => {
  const { messages, room } = fixture();
  expect(() =>
    messages.post({
      roomId: room.id,
      author: "tom",
      body: "hi",
      authorKind: "ghost" as unknown as "human",
    }),
  ).toThrow(Invalid);
});

test("stores a code body with its indentation and trailing newline intact", () => {
  const { messages, room } = fixture();
  const body = "  def f():\n    return 1\n";
  const posted = messages.post({ roomId: room.id, author: "tom", body, kind: "code", lang: "python" });
  expect(posted.body).toBe(body);
  expect(messages.latest(room.id)[0]!.body).toBe(body);
});

test("attributes a post to the bot already holding that name rather than refusing it", () => {
  const { rooms, messages, room } = fixture();
  rooms.join(room.id, "ada", "bot");
  const posted = messages.post({ roomId: room.id, author: "ada", body: "beep" });
  expect(posted.author).toBe("ada");
  expect(rooms.participants(room.id)).toHaveLength(1);
  expect(rooms.participants(room.id)[0]!.kind).toBe("bot");
});

test("refuses a message kind the schema would reject", () => {
  const { messages, room } = fixture();
  expect(() =>
    messages.post({
      roomId: room.id,
      author: "tom",
      body: "hi",
      kind: "shout" as unknown as "text",
    }),
  ).toThrow(Invalid);
});

test("hands back only a page when paging forwards through a longer backlog", () => {
  const { messages, room } = fixture();
  fill((body) => messages.post({ roomId: room.id, author: "tom", body }), 5);
  expect(messages.since(room.id, 0, 2).map((m) => m.body)).toEqual(["m0", "m1"]);
  expect(messages.since(room.id, 2, 2).map((m) => m.body)).toEqual(["m2", "m3"]);
});

test("walks the whole history backwards one page at a time", () => {
  const { messages, room } = fixture();
  fill((body) => messages.post({ roomId: room.id, author: "tom", body }), 5);
  const pages: string[][] = [];
  let cursor = 6;
  for (;;) {
    const page = messages.before(room.id, cursor, 2);
    if (page.length === 0) break;
    pages.push(page.map((m) => m.body));
    cursor = page[0]!.seq;
  }
  expect(pages).toEqual([["m3", "m4"], ["m1", "m2"], ["m0"]]);
});

test("reads a page's attachments in one query rather than one per message", () => {
  const { store, messages, room } = fixture();
  for (let i = 1; i <= 5; i += 1) {
    const blobId = String(i).repeat(64);
    store.insertBlob({ id: blobId, mime: "text/plain", size: 1, createdAt: Date.now() });
    messages.post({
      roomId: room.id,
      author: "tom",
      body: `message ${i}`,
      attachments: [{ blobId, filename: `file-${i}.txt` }],
    });
  }

  const reads = spyOn(store, "attachmentsForMessages");
  const page = messages.latest(room.id);

  expect(page.map((m) => m.attachments.map((a) => a.filename))).toEqual([
    ["file-1.txt"],
    ["file-2.txt"],
    ["file-3.txt"],
    ["file-4.txt"],
    ["file-5.txt"],
  ]);
  expect(reads).toHaveBeenCalledTimes(1);
});
