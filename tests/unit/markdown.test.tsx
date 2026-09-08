import { test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "../../src/web/markdown.tsx";

const html = (source: string) => renderToStaticMarkup(<div>{renderMarkdown(source)}</div>);

test("renders a fenced block inside a longer message as its own code element", () => {
  const markup = html("here is the fix:\n\n```ts\nconst x = 1;\n```\n\nlet me know");
  expect(markup).toContain("here is the fix:");
  expect(markup).toContain("let me know");
  expect(markup).toMatch(/<pre[^>]*>.*const.*<\/pre>/s);
  expect(markup).not.toContain("```");
});

test("renders inline code without treating it as a block", () => {
  const markup = html("run `bun test` first");
  expect(markup).toContain("<code>bun test</code>");
  expect(markup).not.toContain("<pre");
});

test("renders a bullet list as list items", () => {
  const markup = html("- one\n- two");
  expect(markup).toContain("<ul>");
  expect(markup).toContain("<li>one</li>");
  expect(markup).toContain("<li>two</li>");
});

test("renders a numbered list in order", () => {
  const markup = html("1. first\n2. second");
  expect(markup).toContain("<ol");
  expect(markup).toContain("<li>first</li>");
});

test("renders a link with its href", () => {
  const markup = html("see [the docs](https://example.com/docs)");
  expect(markup).toContain('href="https://example.com/docs"');
  expect(markup).toContain("the docs");
});

test("renders emphasis and headings", () => {
  expect(html("**loud** and *quiet*")).toContain("<strong>loud</strong>");
  expect(html("## a heading")).toContain("<h2>a heading</h2>");
  expect(html("> quoted")).toContain("<blockquote>");
});

test("renders an unhandled construct as its own text rather than dropping it", () => {
  const markup = html('[the docs]: https://example.com/docs "reference"');
  expect(markup).toContain("[the docs]: https://example.com/docs");
});

test("renders a markdown table as a table", () => {
  const markup = html("| step | status |\n| --- | --- |\n| collect | done |\n| render | pending |");
  expect(markup).toContain("<table>");
  expect(markup).toContain("<thead>");
  expect(markup).toContain("<tbody>");
  expect(markup).toMatch(/<th[^>]*>step<\/th>/);
  expect(markup).toMatch(/<td[^>]*>pending<\/td>/);
  expect(markup).not.toContain("| --- |");
});

test("renders formatting inside a table cell", () => {
  const markup = html("| tokens |\n| --- |\n| **231** |");
  expect(markup).toContain("<strong>231</strong>");
  expect(markup).not.toContain("**231**");
});

test("applies column alignment from the delimiter row", () => {
  const markup = html("| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |");
  expect(markup).toContain("text-align:left");
  expect(markup).toContain("text-align:center");
  expect(markup).toContain("text-align:right");
});

test("renders a table with no body rows without throwing", () => {
  const markup = html("| a | b |\n| - | - |");
  expect(markup).toContain("<table>");
  expect(markup).toMatch(/<th[^>]*>a<\/th>/);
});

test("keeps a wide table in a container that can scroll on its own", () => {
  const markup = html("| a | b |\n| - | - |\n| 1 | 2 |");
  expect(markup).toMatch(/<div class="table-scroll">\s*<table>/);
});

test("leaves an html tag in a message as visible text", () => {
  const markup = html('look at this <img src=x onerror="alert(1)"> tag');
  expect(markup).toContain("&lt;img");
  expect(markup).not.toContain("<img");
});
