import { test, expect } from "./fixtures";
import { createRoom, postMessage, uploadBlob } from "./api";
import { widePng } from "./png";

const UNBROKEN_TOKEN = "z9Qv7Kd2".repeat(25);

const LONG_URL = `https://example.com/${"deployment-log/".repeat(14)}index.html?token=${"a".repeat(64)}`;

const WIDE_TABLE = [
  "| step | owner | attempts | started | finished | notes |",
  "| --- | --- | ---: | --- | --- | --- |",
  "| collect the transcript | ada | **231** | 2026-09-01T09:00:00Z | 2026-09-01T09:41:00Z | nothing surprising in the log |",
  "| re-render the room | grace | 4 | 2026-09-02T11:15:00Z | 2026-09-02T11:59:00Z | waiting on the layout fix to land |",
].join("\n");

const WIDE_CODE = [
  "```ts",
  `const settings = { label: ${JSON.stringify(UNBROKEN_TOKEN)}, retries: 3, endpoint: ${JSON.stringify(LONG_URL)} };`,
  `export const banner = ${JSON.stringify("=".repeat(220))};`,
  "```",
].join("\n");

const NESTED_LIST = [
  "- collect",
  "  - read the transcript",
  "    - page it in batches",
  "      - keep the cursor at the newest sequence number seen so far",
  "        - and never rewind it once a socket is open on that cursor",
  "          - which is what keeps a slow reader from replaying the whole room",
].join("\n");

const SEEDS = [
  `a token with nowhere to break: ${UNBROKEN_TOKEN}`,
  WIDE_TABLE,
  WIDE_CODE,
  `the deploy log is at ${LONG_URL}`,
  NESTED_LIST,
];

async function seededRoom(url: string) {
  const room = await createRoom(url, "wide");
  const blobId = await uploadBlob(url, widePng(), "image/png");
  const bodies = [...SEEDS, `a screenshot far wider than the room:\n\n![wide](/api/blobs/${blobId})`];
  for (const body of bodies) await postMessage(url, room.id, "ada", body, { authorKind: "bot" });
  return { room, seeded: bodies.length };
}

test("keeps every message inside the width of the transcript", async ({ page, server }) => {
  const { room, seeded } = await seededRoom(server.url);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const transcript = page.getByTestId("transcript");
  await expect(transcript.locator("li.message")).toHaveCount(seeded);
  // Measuring before the bytes arrive measures a zero-width placeholder, which
  // fits inside anything.
  await expect
    .poll(() =>
      transcript.locator("img").first().evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBe(1200);

  const overflowing = await transcript.evaluate((root) => {
    const scrollsHorizontally = (el: Element) => {
      const overflowX = getComputedStyle(el).overflowX;
      return overflowX === "auto" || overflowX === "scroll";
    };
    const insideAScroller = (el: Element) => {
      for (let parent = el.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (scrollsHorizontally(parent)) return true;
      }
      return false;
    };
    const limit = root.getBoundingClientRect().right;
    return [...root.querySelectorAll("*")]
      .filter((el) => !insideAScroller(el))
      .filter((el) => el.getBoundingClientRect().right > limit + 1)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
  });

  expect(overflowing).toEqual([]);
});

test("scrolls a wide code block inside its card instead of widening the bubble", async ({
  page,
  server,
}) => {
  const { room } = await seededRoom(server.url);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const transcript = page.getByTestId("transcript");
  const code = transcript.locator("pre code").first();
  await expect(code).toBeVisible();

  const measured = await code.evaluate((el) => {
    const card = el.closest(".code-block") as HTMLElement;
    const root = el.closest("[data-testid=transcript]") as HTMLElement;
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      cardRight: card.getBoundingClientRect().right,
      transcriptRight: root.getBoundingClientRect().right,
    };
  });

  expect(measured.scrollWidth).toBeGreaterThan(measured.clientWidth);
  expect(measured.cardRight).toBeLessThanOrEqual(measured.transcriptRight + 1);
});
