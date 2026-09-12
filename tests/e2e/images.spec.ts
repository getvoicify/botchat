import { test, expect } from "./fixtures";
import { createRoom, postMessage, uploadBlob } from "./api";
import { redPng } from "./png";

type Locator = import("@playwright/test").Locator;

type Page = import("@playwright/test").Page;

const naturalWidthOf = (image: Locator) =>
  image.evaluate((el) => (el as HTMLImageElement).naturalWidth);

// Enough to overflow the transcript. In a short room scrollHeight equals
// clientHeight and "still at the bottom" is true however the scroll behaves.
const SEEDED = 80;

const metricsOf = (page: Page) =>
  page.getByTestId("transcript").evaluate((el) => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));

const distanceFromBottom = async (page: Page) => {
  const { scrollTop, scrollHeight, clientHeight } = await metricsOf(page);
  return scrollHeight - scrollTop - clientHeight;
};

// Without a delay the bytes can arrive before the first follow-scroll, and the
// test then passes whether or not the re-scroll exists.
const slowBlobs = (page: Page) =>
  page.route("**/api/blobs/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });

async function openCrowdedRoom(page: Page, url: string) {
  const room = await createRoom(url, "crowded");
  for (let i = 1; i <= SEEDED; i += 1) {
    await postMessage(url, room.id, "tom", `line ${i} of ${SEEDED}`);
  }
  await page.goto(`${url}/rooms/${room.id}?as=tom`);
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toContainText(`line ${SEEDED} of ${SEEDED}`);
  await expect(transcript).toHaveAttribute("data-connection", "open");
  const opened = await metricsOf(page);
  expect(opened.scrollHeight).toBeGreaterThan(opened.clientHeight + 200);
  return room;
}

test("shows an inline markdown image", async ({ page, server }) => {
  const room = await createRoom(server.url, "charts");
  const blobId = await uploadBlob(server.url, redPng(), "image/png");
  await postMessage(server.url, room.id, "ada", `here it is: ![a chart](/api/blobs/${blobId})`);

  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  const image = page.getByTestId("transcript").getByRole("img", { name: "a chart" });
  await expect(image).toBeVisible();
  await expect.poll(() => naturalWidthOf(image)).toBe(48);
});

test("opens the original when an embedded image is clicked", async ({ page, server }) => {
  const room = await createRoom(server.url, "full size");
  const blobId = await uploadBlob(server.url, redPng(), "image/png");
  await postMessage(server.url, room.id, "ada", `![a chart](/api/blobs/${blobId})`);

  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  const image = page.getByTestId("transcript").getByRole("img", { name: "a chart" });
  await expect.poll(() => naturalWidthOf(image)).toBe(48);
  const opens = await image.evaluate((el) => el.closest("a")?.getAttribute("href"));
  expect(opens).toBe(`/api/blobs/${blobId}`);
});

test("shows an attached image in place rather than as a download link", async ({
  page,
  server,
}) => {
  const room = await createRoom(server.url, "screenshots");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await page
    .getByLabel("Attach a file")
    .setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: redPng() });
  await page.getByLabel("Message").fill("look at this");
  await page.getByRole("button", { name: "Send" }).click();

  const transcript = page.getByTestId("transcript");
  const image = transcript.getByRole("img", { name: "chart.png" });
  await expect.poll(() => naturalWidthOf(image)).toBe(48);
});

test("keeps the filename and size beneath an attached image", async ({ page, server }) => {
  const room = await createRoom(server.url, "captions");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await page
    .getByLabel("Attach a file")
    .setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: redPng() });
  await page.getByLabel("Message").fill("with a caption");
  await page.getByRole("button", { name: "Send" }).click();

  const caption = page.getByTestId("transcript").locator(".caption");
  await expect(caption).toContainText("chart.png");
  await expect(caption).toContainText(`${redPng().length} bytes`);
  const download = caption.getByRole("link", { name: "chart.png" });
  const res = await page.request.get(
    new URL((await download.getAttribute("href"))!, server.url).toString(),
  );
  expect(Buffer.from(await res.body()).equals(redPng())).toBe(true);
});

test("leaves a non-image attachment as a plain link", async ({ page, server }) => {
  const room = await createRoom(server.url, "not an image");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await page
    .getByLabel("Attach a file")
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("plain") });
  await page.getByLabel("Message").fill("read this");
  await page.getByRole("button", { name: "Send" }).click();

  const transcript = page.getByTestId("transcript");
  await expect(transcript.getByRole("link", { name: "notes.txt" })).toBeVisible();
  await expect(transcript.getByRole("button", { name: "Preview" })).toBeVisible();
  await expect(transcript.locator("img")).toHaveCount(0);
});

test("falls back to the alt text when the image cannot load", async ({ page, server }) => {
  const room = await createRoom(server.url, "broken");
  await postMessage(server.url, room.id, "ada", "![the missing chart](/api/blobs/deadbeef)");

  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  const transcript = page.getByTestId("transcript");
  const fallback = transcript.locator(".image-failed");
  await expect(fallback).toContainText("the missing chart");
  await expect(fallback).toContainText("could not load");
  await expect(fallback).toHaveAttribute("href", "/api/blobs/deadbeef");
  await expect(transcript.locator("img")).toHaveCount(0);
});

test("stays at the bottom once an arriving image has loaded", async ({ page, server }) => {
  await slowBlobs(page);
  const room = await openCrowdedRoom(page, server.url);
  const blobId = await uploadBlob(server.url, redPng(), "image/png");

  await postMessage(server.url, room.id, "ada", `the newest thing ![a chart](/api/blobs/${blobId})`);
  const image = page.getByTestId("transcript").getByRole("img", { name: "a chart" });
  await expect.poll(() => naturalWidthOf(image)).toBe(48);

  await expect.poll(() => distanceFromBottom(page)).toBeLessThan(4);
  await expect(image).toBeInViewport();
});

test("does not yank the view down when an image arrives while you are reading", async ({
  page,
  server,
}) => {
  await slowBlobs(page);
  const room = await openCrowdedRoom(page, server.url);
  const blobId = await uploadBlob(server.url, redPng(), "image/png");
  // Far enough up to count as behind, near enough that the browser still fetches
  // the image arriving below the fold — a never-loaded image proves nothing.
  await page.getByTestId("transcript").evaluate((el) => {
    el.scrollTop = el.scrollHeight - el.clientHeight - 400;
  });
  const reading = (await metricsOf(page)).scrollTop;

  await postMessage(server.url, room.id, "ada", `look away ![a chart](/api/blobs/${blobId})`);
  const image = page.getByTestId("transcript").getByRole("img", { name: "a chart" });
  await expect.poll(() => naturalWidthOf(image)).toBe(48);

  expect((await metricsOf(page)).scrollTop).toBe(reading);
  await expect(page.getByTestId("jump-to-latest")).toBeVisible();
});
