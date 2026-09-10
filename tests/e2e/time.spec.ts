import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

// Freeze at the real current time, not an arbitrary past date: createdAt comes
// from the server's real clock, so a page frozen in the past sees every message
// as being from the future and renders "just now" whatever the formatter does.
async function openRoomWithFrozenClock(page: Page, url: string, roomId: string) {
  await page.clock.install({ time: new Date() });
  await page.goto(`${url}/rooms/${roomId}?as=tom`);
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toHaveAttribute("data-connection", "open");
  return transcript;
}

test("shows just now for a message that has only just arrived", async ({ page, server }) => {
  const room = await createRoom(server.url, "fresh");
  const transcript = await openRoomWithFrozenClock(page, server.url, room.id);

  await postMessage(server.url, room.id, "ada", "morning", { authorKind: "bot" });

  await expect(transcript).toContainText("morning");
  await expect(transcript.locator("li.message time")).toHaveText("just now");
});

test("counts up without a reload", async ({ page, server }) => {
  const room = await createRoom(server.url, "ticking");
  const transcript = await openRoomWithFrozenClock(page, server.url, room.id);

  await postMessage(server.url, room.id, "ada", "morning", { authorKind: "bot" });
  const stamp = transcript.locator("li.message time");
  await expect(stamp).toHaveText("just now");

  // Half a minute past five leaves the rendered minute unchanged by however long
  // the setup above really took, which the frozen clock does not absorb.
  await page.clock.fastForward("05:30");

  await expect(stamp).toHaveText("5m");
  // fastForward runs the socket's reconnect timers too, so a transcript that
  // emptied or a connection that flipped would otherwise look like a render bug.
  await expect(transcript).toHaveAttribute("data-connection", "open");
  await expect(transcript).toContainText("morning");
});

test("carries the absolute time in a tooltip", async ({ page, server }) => {
  const room = await createRoom(server.url, "tooltip");
  const transcript = await openRoomWithFrozenClock(page, server.url, room.id);

  await postMessage(server.url, room.id, "ada", "morning", { authorKind: "bot" });
  const stamp = transcript.locator("li.message time");
  await expect(stamp).toHaveText("just now");

  const machine = await stamp.getAttribute("datetime");
  const title = await stamp.getAttribute("title");
  expect(title).toBe(await page.evaluate((iso) => new Date(iso).toLocaleString(), machine!));
  expect(title).not.toBe("just now");
});

test("carries a machine-readable timestamp", async ({ page, server }) => {
  const room = await createRoom(server.url, "machine");
  const transcript = await openRoomWithFrozenClock(page, server.url, room.id);

  await postMessage(server.url, room.id, "ada", "morning", { authorKind: "bot" });
  const stamp = transcript.locator("li.message time");
  await expect(stamp).toHaveText("just now");

  const machine = await stamp.getAttribute("datetime");
  expect(machine).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Math.abs(Date.parse(machine!) - Date.now())).toBeLessThan(60_000);
});
