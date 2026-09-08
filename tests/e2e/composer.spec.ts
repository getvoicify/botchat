import { test, expect } from "./fixtures";
import { createRoom } from "./api";

type Page = import("@playwright/test").Page;

const lines = (count: number) =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");

const WRAPPING = `a single unbroken sentence ${"that keeps going and going ".repeat(8)}`;

const heightOf = (page: Page) => page.getByLabel("Message").evaluate((el) => el.clientHeight);

const overflows = (page: Page) =>
  page.getByLabel("Message").evaluate((el) => el.scrollHeight > el.clientHeight + 8);

const textFile = { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") };

async function openRoom(page: Page, url: string, name: string) {
  const room = await createRoom(url, name);
  await page.goto(`${url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");
  return room;
}

test("grows as you type and stops growing", async ({ page, server }) => {
  await openRoom(page, server.url, "growing");
  const composer = page.getByLabel("Message");

  await composer.fill("one line");
  const single = await heightOf(page);

  await composer.fill(WRAPPING);
  expect(await heightOf(page)).toBeGreaterThan(single);

  await composer.fill(lines(20));
  const twenty = await heightOf(page);
  expect(twenty).toBeGreaterThan(single);

  await composer.fill(lines(60));
  expect(await heightOf(page)).toBe(twenty);
  expect(await overflows(page)).toBe(true);
});

test("will not send an empty message", async ({ page, server }) => {
  await openRoom(page, server.url, "empty");
  const composer = page.getByLabel("Message");
  const send = page.getByRole("button", { name: "Send" });

  await expect(send).toBeDisabled();
  await composer.fill("   ");
  await expect(send).toBeDisabled();
  await composer.press("Enter");
  await expect(page.getByTestId("transcript").locator("li")).toHaveCount(0);

  await composer.fill("something to say");
  await expect(send).toBeEnabled();
});

test("sends a message that has only an attachment", async ({ page, server }) => {
  await openRoom(page, server.url, "attachment only");
  await page.getByLabel("Attach a file").setInputFiles(textFile);
  await expect(page.getByTestId("pending-attachments")).toContainText("notes.txt");

  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page.getByTestId("transcript").getByRole("link", { name: "notes.txt" }),
  ).toBeVisible();
});

test("shows the pending file inside the composer", async ({ page, server }) => {
  await openRoom(page, server.url, "pending inside");
  await page.getByLabel("Attach a file").setInputFiles(textFile);

  await expect(
    page.getByTestId("composer").getByTestId("pending-attachments"),
  ).toContainText("notes.txt");
});
