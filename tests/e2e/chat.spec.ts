import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

test("shows a message to another browser without a reload", async ({ browser, server }) => {
  const room = await createRoom(server.url, "live");
  const tom = await (await browser.newContext()).newPage();
  const ada = await (await browser.newContext()).newPage();

  await tom.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await ada.goto(`${server.url}/rooms/${room.id}?as=ada`);
  await expect(ada.getByTestId("transcript")).toHaveAttribute("data-connection", "open");

  await tom.getByLabel("Message").fill("hello from tom");
  await tom.getByRole("button", { name: "Send" }).click();

  await expect(ada.getByTestId("transcript")).toContainText("hello from tom");
  await expect(ada.getByTestId("transcript")).toContainText("tom");
});

test("shows the history that existed before the page was opened", async ({ page, server }) => {
  const room = await createRoom(server.url, "backfill");
  await postMessage(server.url, room.id, "ada", "said before you arrived");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("transcript")).toContainText("said before you arrived");
});

test("does not show a message posted to a different room", async ({ page, server }) => {
  const mine = await createRoom(server.url, "mine");
  const theirs = await createRoom(server.url, "theirs");
  await page.goto(`${server.url}/rooms/${mine.id}?as=tom`);
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");
  await postMessage(server.url, theirs.id, "ada", "not for you");
  await postMessage(server.url, mine.id, "ada", "for you");
  await expect(page.getByTestId("transcript")).toContainText("for you");
  await expect(page.getByTestId("transcript")).not.toContainText("not for you");
});

test("keeps every message after a reload", async ({ page, server }) => {
  const room = await createRoom(server.url, "durable");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await page.getByLabel("Message").fill("written once");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("transcript")).toContainText("written once");
  await page.reload();
  await expect(page.getByTestId("transcript")).toContainText("written once");
});
