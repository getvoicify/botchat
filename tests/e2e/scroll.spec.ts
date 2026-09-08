import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

// Enough to overflow the transcript. In a short room scrollHeight equals
// clientHeight, "at the bottom" is trivially true, and every assertion below
// passes against a transcript that cannot scroll at all.
const SEEDED = 80;

const seeded = (i: number) => `line ${i} of ${SEEDED}`;

type Page = import("@playwright/test").Page;

type Metrics = { scrollTop: number; scrollHeight: number; clientHeight: number };

const metricsOf = (page: Page): Promise<Metrics> =>
  page.getByTestId("transcript").evaluate((el) => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));

const distanceFromBottom = async (page: Page) => {
  const { scrollTop, scrollHeight, clientHeight } = await metricsOf(page);
  return scrollHeight - scrollTop - clientHeight;
};

const scrollToTop = (page: Page) =>
  page.getByTestId("transcript").evaluate((el) => {
    el.scrollTop = 0;
  });

async function openCrowdedRoom(page: Page, url: string) {
  const room = await createRoom(url, "crowded");
  for (let i = 1; i <= SEEDED; i += 1) await postMessage(url, room.id, "tom", seeded(i));
  await page.goto(`${url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("transcript")).toContainText(seeded(SEEDED));
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");
  const opened = await metricsOf(page);
  expect(opened.scrollHeight).toBeGreaterThan(opened.clientHeight + 200);
  return room;
}

test("follows the newest message when you are already at the bottom", async ({ page, server }) => {
  const room = await openCrowdedRoom(page, server.url);

  await postMessage(server.url, room.id, "ada", "the newest thing");
  await expect(page.getByTestId("transcript")).toContainText("the newest thing");

  await expect.poll(() => distanceFromBottom(page)).toBeLessThan(4);
  await expect(page.getByText("the newest thing")).toBeInViewport();
});

test("stays put when you have scrolled up to read", async ({ page, server }) => {
  const room = await openCrowdedRoom(page, server.url);
  await scrollToTop(page);
  expect((await metricsOf(page)).scrollTop).toBe(0);

  await postMessage(server.url, room.id, "ada", "arrived while you were reading");
  await expect(page.getByTestId("transcript")).toContainText("arrived while you were reading");
  await page.waitForTimeout(250);

  expect((await metricsOf(page)).scrollTop).toBe(0);
  await expect(page.getByTestId("jump-to-latest")).toBeVisible();
});

test("returns to the newest message when you ask it to", async ({ page, server }) => {
  const room = await openCrowdedRoom(page, server.url);
  await scrollToTop(page);
  await postMessage(server.url, room.id, "ada", "waiting at the bottom");
  await expect(page.getByTestId("jump-to-latest")).toBeVisible();

  await page.getByTestId("jump-to-latest").click();

  await expect.poll(() => distanceFromBottom(page)).toBeLessThan(4);
  await expect(page.getByText("waiting at the bottom")).toBeInViewport();
  await expect(page.getByTestId("jump-to-latest")).toBeHidden();
});

test("keeps the composer visible however long the transcript is", async ({ page, server }) => {
  await openCrowdedRoom(page, server.url);

  await expect(page.getByLabel("Message")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Send" })).toBeInViewport();
});
