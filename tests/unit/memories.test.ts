import { test, expect } from "bun:test";
import { openDatabase } from "../../src/db/schema.ts";
import { Store } from "../../src/db/store.ts";
import { RoomService } from "../../src/core/rooms.ts";
import { MessageService } from "../../src/core/messages.ts";
import { MemoryService } from "../../src/core/memories.ts";
import { EventBus } from "../../src/core/bus.ts";
import { Invalid, NotFound } from "../../src/core/errors.ts";

function world() {
  const store = new Store(openDatabase(":memory:"));
  const rooms = new RoomService(store);
  const messages = new MessageService(store, rooms, new EventBus());
  const memories = new MemoryService(store, rooms);
  const open = (name: string) => {
    const room = rooms.create({ name });
    return {
      id: room.id,
      say: (author: string, body: string) =>
        messages.post({ roomId: room.id, author, body }).seq,
    };
  };
  return { store, rooms, messages, memories, open };
}

const rowCounts = (store: Store) => ({
  memories: store.db.query("SELECT COUNT(*) AS n FROM memories").get() as { n: number },
  pinned: store.db.query("SELECT COUNT(*) AS n FROM memory_messages").get() as { n: number },
  indexed: store.db.query("SELECT COUNT(*) AS n FROM memory_search").get() as { n: number },
});

test("hands back the pinned messages alongside the note so a reader needs no second lookup", () => {
  const { memories, open } = world();
  const room = open("design");
  const question = room.say("tom", "should we cache the feed?");
  const answer = room.say("ada", "yes, for sixty seconds");

  const pinned = memories.pin({
    roomId: room.id,
    author: "scribe",
    messageSeqs: [question, answer],
    note: "the caching decision",
  });

  expect(pinned.note).toBe("the caching decision");
  expect(pinned.pinnedBy).toBe("scribe");
  expect(pinned.messages).toEqual([
    { seq: question, author: "tom", body: "should we cache the feed?" },
    { seq: answer, author: "ada", body: "yes, for sixty seconds" },
  ]);
});

test("admits a bot that pins something before it has ever spoken", () => {
  const { memories, rooms, open } = world();
  const room = open("design");
  const seq = room.say("tom", "hello");
  memories.pin({ roomId: room.id, author: "scribe", messageSeqs: [seq], note: "the greeting" });
  expect(rooms.participants(room.id).find((p) => p.name === "scribe")?.kind).toBe("bot");
});

test("does not turn a person who pins something into a bot", () => {
  const { memories, rooms, open } = world();
  const room = open("design");
  const seq = room.say("tom", "hello");
  memories.pin({ roomId: room.id, author: "tom", messageSeqs: [seq], note: "my own words" });
  expect(rooms.participants(room.id).find((p) => p.name === "tom")?.kind).toBe("human");
});

test("refuses to pin a message that belongs to another room", () => {
  const { memories, open } = world();
  const ours = open("ours");
  const theirs = open("theirs");
  const mine = ours.say("tom", "our decision");
  const yours = theirs.say("eve", "their secret");

  expect(() =>
    memories.pin({
      roomId: ours.id,
      author: "scribe",
      messageSeqs: [mine, yours],
      note: "reaching across",
    }),
  ).toThrow(Invalid);
});

test("writes nothing at all when one of the pinned messages belongs to another room", () => {
  const { store, memories, open } = world();
  const ours = open("ours");
  const theirs = open("theirs");
  const mine = ours.say("tom", "our decision");
  const yours = theirs.say("eve", "their secret");
  memories.pin({ roomId: ours.id, author: "scribe", messageSeqs: [mine], note: "a real pin" });
  const before = rowCounts(store);

  try {
    memories.pin({
      roomId: ours.id,
      author: "scribe",
      messageSeqs: [mine, yours],
      note: "reaching across",
    });
  } catch {}

  expect(rowCounts(store)).toEqual(before);
  expect(before.memories.n).toBe(1);
});

test("refuses to pin no messages at all", () => {
  const { memories, open } = world();
  const room = open("design");
  expect(() =>
    memories.pin({ roomId: room.id, author: "scribe", messageSeqs: [], note: "about nothing" }),
  ).toThrow(Invalid);
});

test("refuses to pin without saying why it matters", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("tom", "hello");
  expect(() =>
    memories.pin({ roomId: room.id, author: "scribe", messageSeqs: [seq], note: "   " }),
  ).toThrow(Invalid);
});

test("refuses to pin a message that was never written", () => {
  const { memories, open } = world();
  const room = open("design");
  room.say("tom", "hello");
  expect(() =>
    memories.pin({ roomId: room.id, author: "scribe", messageSeqs: [999], note: "a ghost" }),
  ).toThrow(Invalid);
});

test("raises NotFound when pinning into a room that was never created", () => {
  const { memories } = world();
  expect(() =>
    memories.pin({ roomId: "nope", author: "scribe", messageSeqs: [1], note: "nowhere" }),
  ).toThrow(NotFound);
});

test("finds a memory by a word from its note", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("ada", "sixty seconds");
  const pinned = memories.pin({
    roomId: room.id,
    author: "scribe",
    messageSeqs: [seq],
    note: "the caching decision",
  });
  expect(memories.search(room.id, "caching").map((h) => h.id)).toEqual([pinned.id]);
});

test("finds a memory by words that appear only in the pinned messages", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("ada", "we fall back to the origin whenever the edge is cold");
  const pinned = memories.pin({
    roomId: room.id,
    author: "scribe",
    messageSeqs: [seq],
    note: "read before touching delivery",
  });
  expect(memories.search(room.id, "cold edge").map((h) => h.id)).toEqual([pinned.id]);
});

test("marks the matching words in the excerpt it hands back", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("ada", "sixty seconds");
  memories.pin({
    roomId: room.id,
    author: "scribe",
    messageSeqs: [seq],
    note: "the caching decision",
  });
  expect(memories.search(room.id, "caching")[0]?.excerpt).toContain("[caching]");
});

test("keeps one room's memories out of another room's search", () => {
  const { memories, open } = world();
  const ours = open("ours");
  const theirs = open("theirs");
  const yours = theirs.say("eve", "the launch password is hunter2");
  const pinned = memories.pin({
    roomId: theirs.id,
    author: "scribe",
    messageSeqs: [yours],
    note: "the launch password",
  });

  expect(memories.search(theirs.id, "password").map((h) => h.id)).toEqual([pinned.id]);
  expect(memories.search(ours.id, "password")).toEqual([]);
});

test("leaves an unpinned memory out of the search results", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("ada", "sixty seconds");
  const args = { roomId: room.id, author: "scribe", messageSeqs: [seq] };
  const kept = memories.pin({ ...args, note: "the caching decision stands" });
  const dropped = memories.pin({ ...args, note: "the caching decision we reversed" });

  memories.unpin(dropped.id);

  expect(memories.search(room.id, "caching").map((h) => h.id)).toEqual([kept.id]);
});

test("leaves an unpinned memory out of the list", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("ada", "sixty seconds");
  const args = { roomId: room.id, author: "scribe", messageSeqs: [seq] };
  const kept = memories.pin({ ...args, note: "still true" });
  const dropped = memories.pin({ ...args, note: "no longer true" });

  memories.unpin(dropped.id);

  expect(memories.list(room.id).map((m) => m.id)).toEqual([kept.id]);
});

test("lists the newest memory first", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("ada", "sixty seconds");
  const args = { roomId: room.id, author: "scribe", messageSeqs: [seq] };
  const older = memories.pin({ ...args, note: "decided first" });
  const newer = memories.pin({ ...args, note: "decided second" });
  expect(memories.list(room.id).map((m) => m.id)).toEqual([newer.id, older.id]);
});

test("returns at most as many memories as it was asked for", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("ada", "sixty seconds");
  const args = { roomId: room.id, author: "scribe", messageSeqs: [seq] };
  memories.pin({ ...args, note: "first" });
  memories.pin({ ...args, note: "second" });
  memories.pin({ ...args, note: "third" });
  expect(memories.list(room.id, 2)).toHaveLength(2);
});

test("reports the same memory when it is unpinned twice", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("ada", "sixty seconds");
  const pinned = memories.pin({
    roomId: room.id,
    author: "scribe",
    messageSeqs: [seq],
    note: "reversed later",
  });
  const first = memories.unpin(pinned.id);
  expect(memories.unpin(pinned.id)).toEqual(first);
});

test("raises NotFound when unpinning a memory that was never pinned", () => {
  const { memories } = world();
  expect(() => memories.unpin("nope")).toThrow(NotFound);
});

test("searches for a phrase containing a quote without throwing", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("ada", "sixty seconds at the edge");
  const pinned = memories.pin({
    roomId: room.id,
    author: "scribe",
    messageSeqs: [seq],
    note: 'we settled on the "caching" strategy for the feed',
  });
  expect(memories.search(room.id, 'the "caching strategy').map((h) => h.id)).toEqual([pinned.id]);
});

test("treats AND in a query as a word, not an operator", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("ada", "sixty seconds at the edge");
  const pinned = memories.pin({
    roomId: room.id,
    author: "scribe",
    messageSeqs: [seq],
    note: "the filter must AND the two predicates together",
  });
  expect(memories.search(room.id, "AND predicates").map((h) => h.id)).toEqual([pinned.id]);
});

test("returns nothing rather than throwing for a query of only punctuation", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("ada", "sixty seconds at the edge");
  const pinned = memories.pin({
    roomId: room.id,
    author: "scribe",
    messageSeqs: [seq],
    note: "the caching decision",
  });

  expect(memories.search(room.id, "caching").map((h) => h.id)).toEqual([pinned.id]);
  expect(memories.search(room.id, "!!! ???")).toEqual([]);
});

test("returns nothing rather than throwing for an empty query", () => {
  const { memories, open } = world();
  const room = open("design");
  const seq = room.say("ada", "sixty seconds at the edge");
  const pinned = memories.pin({
    roomId: room.id,
    author: "scribe",
    messageSeqs: [seq],
    note: "the caching decision",
  });

  expect(memories.search(room.id, "caching").map((h) => h.id)).toEqual([pinned.id]);
  expect(memories.search(room.id, "   ")).toEqual([]);
});
