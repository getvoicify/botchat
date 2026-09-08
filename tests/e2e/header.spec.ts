import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

test("names the room it is showing", async ({ page, server }) => {
  const room = await createRoom(server.url, "release planning");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByRole("heading", { name: "release planning" })).toBeVisible();
});

test("shows the topic the room was given", async ({ page, server }) => {
  const room = await createRoom(server.url, "release planning", "what ships on friday");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("topic")).toHaveText("what ships on friday");
});

test("marks a bot in the roster and in the transcript", async ({ page, server }) => {
  const room = await createRoom(server.url, "mixed");
  await postMessage(server.url, room.id, "tom", "hello");
  await postMessage(server.url, room.id, "ada", "beep", { authorKind: "bot" });
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  await expect(page.getByTestId("roster")).toContainText("tom");
  await expect(page.getByTestId("roster")).toContainText("ada");

  const fromBot = page.getByTestId("transcript").locator('li[data-kind="bot"]');
  await expect(fromBot).toContainText("beep");
  await expect(fromBot).toContainText("bot");
  await expect(page.getByTestId("transcript").locator('li[data-kind="human"]')).toContainText(
    "hello",
  );
});

test("shows the command that points a bot at this server", async ({ page, server }) => {
  const room = await createRoom(server.url, "invite");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("invite")).toBeHidden();

  await page.getByRole("button", { name: /invite a bot/i }).click();

  await expect(page.getByTestId("invite")).toContainText("claude mcp add");
  await expect(page.getByTestId("invite")).toContainText(new URL(server.url).host);
  await expect(page.getByTestId("invite")).toContainText(room.id);
});

test("keeps the roster current when a new participant speaks", async ({ page, server }) => {
  const room = await createRoom(server.url, "growing");
  await postMessage(server.url, room.id, "tom", "anyone there?");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("roster")).toContainText("tom");
  await expect(page.getByTestId("roster")).not.toContainText("ada");

  await postMessage(server.url, room.id, "ada", "beep", { authorKind: "bot" });

  await expect(page.getByTestId("roster")).toContainText("ada");
  await expect(page.getByTestId("transcript").locator('li[data-kind="bot"]')).toContainText("beep");
});
