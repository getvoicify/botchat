import { test, expect } from "./fixtures";
import { postMessage } from "./api";
import {
  AUTHORS,
  ROWS,
  longTasksSeen,
  reportLongTasks,
  seedRoom,
  watchLongTasks,
} from "./transcript";

const ARRIVALS = 10;

test("a message arriving does not re-parse the rest of the transcript", async ({
  page,
  server,
}) => {
  test.setTimeout(180_000);
  const roomId = await seedRoom(server.url, "arrival perf");

  await page.goto(`${server.url}/rooms/${roomId}?as=tom`);
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");
  const rows = page.getByTestId("transcript").locator("li.message");
  await expect(rows).toHaveCount(ROWS);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await watchLongTasks(page);

  // An author the room already knows, so an arrival costs one render rather
  // than a render plus the roster refetch an unknown name would trigger.
  for (let sent = 0; sent < ARRIVALS; sent += 1) {
    await postMessage(server.url, roomId, AUTHORS[0]!, `arrival ${sent} with \`code\` in it`, {
      authorKind: "bot",
    });
    await page.waitForTimeout(150);
  }
  await expect(rows).toHaveCount(ROWS + ARRIVALS);

  const longTasks = await longTasksSeen(page);
  reportLongTasks(`${ARRIVALS} messages arrive`, longTasks);
  expect(longTasks.length).toBeLessThan(5);
});
