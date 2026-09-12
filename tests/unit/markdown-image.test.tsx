import { test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "../../src/web/markdown.tsx";

const html = (source: string) => renderToStaticMarkup(<div>{renderMarkdown(source)}</div>);

test("renders a markdown image as an image element", () => {
  const markup = html("look: ![a chart](/api/blobs/abc)");
  expect(markup).toContain("look:");
  expect(markup).toMatch(/<img[^>]+src="\/api\/blobs\/abc"/);
  expect(markup).not.toContain("![a chart]");
});

test("uses the alt text from the markdown", () => {
  expect(html("![a chart](/api/blobs/abc)")).toMatch(/<img[^>]+alt="a chart"/);
});

test("renders an image with no alt text without throwing", () => {
  const markup = html("![](/api/blobs/abc)");
  expect(markup).toMatch(/<img[^>]+src="\/api\/blobs\/abc"/);
  expect(markup).toMatch(/<img[^>]+alt=""/);
});

test("links an embedded image to the full-size original", () => {
  const markup = html("![a chart](/api/blobs/abc)");
  expect(markup).toMatch(/<a [^>]*href="\/api\/blobs\/abc"[^>]*>\s*<img/);
});

test("defers fetching and decoding so a room full of images does not load them all at once", () => {
  const markup = html("![a chart](/api/blobs/abc)");
  expect(markup).toMatch(/<img[^>]+loading="lazy"/);
  expect(markup).toMatch(/<img[^>]+decoding="async"/);
});

test("leaves a bare image URL as a link rather than an image", () => {
  const markup = html("https://example.com/chart.png");
  expect(markup).toContain('href="https://example.com/chart.png"');
  expect(markup).not.toContain("<img");
});
