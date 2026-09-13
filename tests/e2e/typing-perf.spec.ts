import { test, expect } from "./fixtures";
import {
  ROWS,
  longTasksSeen,
  reportLongTasks,
  seedRoom,
  watchLongTasks,
} from "./transcript";

const PHRASE = "hello there how are you";

test("typing into the composer does not re-render the transcript", async ({ page, server }) => {
  test.setTimeout(180_000);
  const roomId = await seedRoom(server.url, "typing perf");

  await page.goto(`${server.url}/rooms/${roomId}?as=tom`);
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");
  await expect(page.getByTestId("transcript").locator("li.message")).toHaveCount(ROWS);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });

  const composer = page.getByLabel("Message");
  await composer.click();
  await watchLongTasks(page);

  await page.keyboard.type(PHRASE, { delay: 40 });

  // React owns the textarea's value, so a run that never reached onChange would
  // report a quiet main thread while having typed nothing at all.
  await expect(composer).toHaveValue(PHRASE);

  const longTasks = await longTasksSeen(page);
  reportLongTasks(`typing ${PHRASE.length} characters`, longTasks);
  expect(longTasks.length).toBeLessThan(5);
});
