import { test, expect } from "bun:test";
import { segmentMentions, suggest } from "../../src/web/mentions.ts";

const ROOM = ["ada", "grace", "claude-tutela", "claude-tutela-enterprise"];

test("turns an @name into a mention when that name is in the room", () => {
  expect(segmentMentions("ping @ada about it", ROOM)).toEqual([
    { kind: "text", text: "ping " },
    { kind: "mention", name: "ada" },
    { kind: "text", text: " about it" },
  ]);
});

test("carries the participant's own casing rather than what was typed", () => {
  expect(segmentMentions("@ADA", ["Ada"])).toEqual([{ kind: "mention", name: "Ada" }]);
});

test("leaves an @name that belongs to nobody as text", () => {
  expect(segmentMentions("ping @nobody", ROOM)).toEqual([{ kind: "text", text: "ping @nobody" }]);
});

test("leaves the @ in an email address alone", () => {
  expect(segmentMentions("write to me@ada for now", ROOM)).toEqual([
    { kind: "text", text: "write to me@ada for now" },
  ]);
});

test("stops a name before the punctuation that follows it", () => {
  expect(segmentMentions("@ada, are you there?", ROOM)).toEqual([
    { kind: "mention", name: "ada" },
    { kind: "text", text: ", are you there?" },
  ]);
});

test("leaves a longer word that merely starts with a participant name as text", () => {
  expect(segmentMentions("@adam said so", ROOM)).toEqual([{ kind: "text", text: "@adam said so" }]);
});

test("prefers the longest participant when one name is a prefix of another", () => {
  expect(segmentMentions("@claude-tutela-enterprise ping", ROOM)).toEqual([
    { kind: "mention", name: "claude-tutela-enterprise" },
    { kind: "text", text: " ping" },
  ]);
});

test("still matches the shorter name when the longer one was not typed", () => {
  expect(segmentMentions("@claude-tutela ping", ROOM)).toEqual([
    { kind: "mention", name: "claude-tutela" },
    { kind: "text", text: " ping" },
  ]);
});

test("matches a name made of regular expression metacharacters", () => {
  expect(segmentMentions("ask @c++ first", ["c++"])).toEqual([
    { kind: "text", text: "ask " },
    { kind: "mention", name: "c++" },
    { kind: "text", text: " first" },
  ]);
});

test("segments two mentions that sit next to each other", () => {
  expect(segmentMentions("@ada @grace", ROOM)).toEqual([
    { kind: "mention", name: "ada" },
    { kind: "text", text: " " },
    { kind: "mention", name: "grace" },
  ]);
});

test("segments a mention that opens the text and one that closes it", () => {
  expect(segmentMentions("@ada please brief @grace", ROOM)).toEqual([
    { kind: "mention", name: "ada" },
    { kind: "text", text: " please brief " },
    { kind: "mention", name: "grace" },
  ]);
});

test("matches a name that opens a new line", () => {
  expect(segmentMentions("first\n@ada", ROOM)).toEqual([
    { kind: "text", text: "first\n" },
    { kind: "mention", name: "ada" },
  ]);
});

test("returns text with no mentions as a single segment", () => {
  expect(segmentMentions("nothing to see", ROOM)).toEqual([
    { kind: "text", text: "nothing to see" },
  ]);
});

test("returns nothing for empty text", () => {
  expect(segmentMentions("", ROOM)).toEqual([]);
});

test("leaves a bare @ as text", () => {
  expect(segmentMentions("@ ada", ROOM)).toEqual([{ kind: "text", text: "@ ada" }]);
});

test("finds no mentions when the room is empty", () => {
  expect(segmentMentions("@ada", [])).toEqual([{ kind: "text", text: "@ada" }]);
});

test("ranks a prefix match above a later substring match", () => {
  expect(suggest(["grace", "ada"], "a")).toEqual(["ada", "grace"]);
});

test("matches regardless of case", () => {
  expect(suggest(["Ada", "grace"], "AD")).toEqual(["Ada"]);
});

test("leaves out the name given as the reader's own", () => {
  expect(suggest(["tom", "ada"], "", "tom")).toEqual(["ada"]);
});

test("leaves it out whatever its casing", () => {
  expect(suggest(["Tom", "ada"], "", "tOM")).toEqual(["ada"]);
});

test("still offers everyone else", () => {
  expect(suggest(["tom", "ada", "grace"], "a", "tom")).toEqual(["ada", "grace"]);
});

test("returns nothing when the only match is the reader", () => {
  expect(suggest(["tom", "ada"], "to", "tom")).toEqual([]);
});
