import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

// More than two backlog batches, so a socket opened at seq 0 cannot reach the
// live edge on the first post that follows.
const SEEDED = 1200;

const seeded = (i: number) => `message ${i} of ${SEEDED}`;

async function busyRoom(url: string) {
  const room = await createRoom(url, "busy");
  for (let i = 1; i <= SEEDED; i += 1) await postMessage(url, room.id, "tom", seeded(i));
  return room;
}

test("opens a busy room at the newest message, not the oldest", async ({ page, server }) => {
  const room = await busyRoom(server.url);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("transcript")).toContainText(seeded(SEEDED));
  await expect(page.getByTestId("transcript")).not.toContainText(seeded(1));
});

test("shows the very next message posted to a busy room", async ({ page, server }) => {
  const room = await busyRoom(server.url);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");
  await postMessage(server.url, room.id, "ada", "the very next thing");
  await expect(page.getByTestId("transcript")).toContainText("the very next thing", {
    timeout: 5_000,
  });
});
