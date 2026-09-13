import { test, expect } from "bun:test";
import { mentionQuery } from "../../src/web/mention-query.ts";

const atEnd = (draft: string) => mentionQuery(draft, draft.length);

test("reads the partial name being typed and where it starts", () => {
  expect(atEnd("ping @ad")).toEqual({ query: "ad", from: 5 });
});

test("opens on a bare @ with nothing typed after it", () => {
  expect(atEnd("@")).toEqual({ query: "", from: 0 });
});

test("reads a name that opens the draft", () => {
  expect(atEnd("@gra")).toEqual({ query: "gra", from: 0 });
});

test("closes once a space follows the @", () => {
  expect(atEnd("@ada ")).toBeNull();
});

test("ignores an @ that sits mid-word", () => {
  expect(atEnd("mail me@exa")).toBeNull();
});

test("finds nothing when no @ has been typed", () => {
  expect(atEnd("just talking")).toBeNull();
});

test("returns nothing when the caret sits before the @", () => {
  expect(mentionQuery("hi @ada", 2)).toBeNull();
});

test("reads only as far as the caret when it sits inside the name", () => {
  expect(mentionQuery("@grace", 3)).toEqual({ query: "gr", from: 0 });
});

test("picks the nearer @ when a line holds two", () => {
  expect(atEnd("@ada and @gr")).toEqual({ query: "gr", from: 9 });
});

test("opens on an @ that starts a later line", () => {
  expect(atEnd("first line\n@ad")).toEqual({ query: "ad", from: 11 });
});

test("finds nothing in an empty draft", () => {
  expect(atEnd("")).toBeNull();
});
