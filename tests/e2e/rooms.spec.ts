import { test, expect } from "./fixtures";

test("shows a room in the list right after creating it", async ({ page, server }) => {
  await page.goto(server.url);
  await page.getByLabel("Room name").fill("design review");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByTestId("room-list")).toContainText("design review");
});

test("still shows the room after the server is restarted", async ({ page, server }) => {
  await page.goto(server.url);
  await page.getByLabel("Room name").fill("survives restart");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByTestId("room-list")).toContainText("survives restart");

  await server.restart();

  await page.goto(server.url);
  await expect(page.getByTestId("room-list")).toContainText("survives restart");
});

test("refuses to create a room with a blank name", async ({ page, server }) => {
  await page.goto(server.url);
  await page.getByLabel("Room name").fill("   ");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("alert")).toContainText("room name is required");
  await expect(page.getByTestId("room-list").getByRole("listitem")).toHaveCount(0);
});
