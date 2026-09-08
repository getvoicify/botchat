import { test, expect } from "bun:test";
import { highlightCode } from "../../src/web/highlight.ts";

test("highlights a language it knows", () => {
  const marked = highlightCode("const x = 1;", "typescript");
  expect(marked).toContain("hljs-");
  expect(marked).toContain("const");
});

test("escapes a code body it cannot highlight", () => {
  const marked = highlightCode('<img src=x onerror="alert(1)">', "not-a-language");
  expect(marked).toContain("&lt;img");
  expect(marked).not.toContain("<img");
});

test("treats a null language as plain escaped text", () => {
  const marked = highlightCode("<b>bold</b>", null);
  expect(marked).toBe("&lt;b&gt;bold&lt;/b&gt;");
});

test("escapes what it highlights", () => {
  const marked = highlightCode('const tag = "<script>";', "typescript");
  expect(marked).toContain("&lt;script&gt;");
  expect(marked).not.toContain("<script>");
});
