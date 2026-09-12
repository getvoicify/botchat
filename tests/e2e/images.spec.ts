import { test, expect } from "./fixtures";
import { createRoom, postMessage, uploadBlob } from "./api";
import { redPng } from "./png";

type Locator = import("@playwright/test").Locator;

const naturalWidthOf = (image: Locator) =>
  image.evaluate((el) => (el as HTMLImageElement).naturalWidth);

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
