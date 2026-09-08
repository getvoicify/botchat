import { test, expect } from "bun:test";
import { parseDraft } from "../../src/web/draft.ts";

test("reads a fenced block as code", () => {
  expect(parseDraft("```\nx = 1\n```")).toEqual({ kind: "code", body: "x = 1", lang: null });
});

test("takes the language from the opening fence", () => {
  expect(parseDraft("```python\nx = 1\n```").lang).toBe("python");
});

test("keeps indentation inside a snippet", () => {
  expect(parseDraft("```\ndef f():\n    return 1\n```").body).toBe("def f():\n    return 1");
});

test("keeps blank lines inside a snippet", () => {
  expect(parseDraft("```\na\n\nb\n```").body).toBe("a\n\nb");
});

test("leaves a lone backtick as ordinary text", () => {
  expect(parseDraft("use `x` here").kind).toBe("text");
});

test("leaves an unclosed fence as ordinary text", () => {
  expect(parseDraft("```\nx = 1").kind).toBe("text");
});

test("leaves prose around a fence as ordinary text", () => {
  expect(parseDraft("look:\n```\nx\n```").kind).toBe("text");
});

test("accepts a language with a dot or plus in it", () => {
  expect(parseDraft("```c++\nint x;\n```").lang).toBe("c++");
});
