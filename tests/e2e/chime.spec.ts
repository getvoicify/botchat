import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

const TONES_PER_CHIME = 2;

// Headless and headed Chromium both report document.hasFocus() as true on every
// page, whichever one bringToFront() was called on, so focus is stubbed here and
// the unit tests are what hold the focus clause.
async function fakeAudio(page: Page, focused: boolean) {
  await page.addInitScript((startsFocused) => {
    const counter = window as unknown as { __chimes: number; AudioContext: unknown };
    counter.__chimes = 0;
    document.hasFocus = () => startsFocused;
    class FakeContext {
      state = "running";
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect: (node: unknown) => node,
        };
      }
      createOscillator() {
        return {
          type: "sine",
          frequency: { value: 0 },
          connect: (node: unknown) => node,
          start() {
            counter.__chimes += 1;
          },
          stop() {},
        };
      }
    }
    counter.AudioContext = FakeContext;
  }, focused);
}

const tonesHeard = (page: Page) =>
  page.evaluate(() => (window as unknown as { __chimes: number }).__chimes);

async function openRoom(page: Page, url: string, roomId: string) {
  await page.goto(`${url}/rooms/${roomId}?as=tom`);
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toHaveAttribute("data-connection", "open");
  return transcript;
}

test("chimes for another participant's message while unfocused", async ({ page, server }) => {
  const room = await createRoom(server.url, "quiet");
  await fakeAudio(page, false);
  const transcript = await openRoom(page, server.url, room.id);

  await postMessage(server.url, room.id, "ada", "beep", { authorKind: "bot" });

  await expect(transcript).toContainText("beep");
  expect(await tonesHeard(page)).toBe(TONES_PER_CHIME);
});

test("does not chime for your own message", async ({ page, server }) => {
  const room = await createRoom(server.url, "solo");
  await fakeAudio(page, false);
  const transcript = await openRoom(page, server.url, room.id);

  await page.getByLabel("Message").fill("talking to myself");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(transcript).toContainText("talking to myself");
  expect(await tonesHeard(page)).toBe(0);
});

test("does not chime while the tab is focused", async ({ page, server }) => {
  const room = await createRoom(server.url, "watched");
  await fakeAudio(page, true);
  const transcript = await openRoom(page, server.url, room.id);

  await postMessage(server.url, room.id, "ada", "beep", { authorKind: "bot" });

  await expect(transcript).toContainText("beep");
  expect(await tonesHeard(page)).toBe(0);
});

test("does not chime when muted", async ({ page, server }) => {
  const room = await createRoom(server.url, "muted");
  await fakeAudio(page, false);
  const transcript = await openRoom(page, server.url, room.id);

  await page.getByTestId("sound-toggle").click();
  await postMessage(server.url, room.id, "ada", "beep", { authorKind: "bot" });

  await expect(transcript).toContainText("beep");
  expect(await tonesHeard(page)).toBe(0);
});

test("remembers the mute setting across a reload", async ({ page, server }) => {
  const room = await createRoom(server.url, "remembered");
  await fakeAudio(page, false);
  await openRoom(page, server.url, room.id);

  await page.getByRole("button", { name: "Mute notifications" }).click();
  await page.reload();

  await expect(page.getByRole("button", { name: "Unmute notifications" })).toBeVisible();
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toHaveAttribute("data-connection", "open");

  await postMessage(server.url, room.id, "ada", "beep", { authorKind: "bot" });

  await expect(transcript).toContainText("beep");
  expect(await tonesHeard(page)).toBe(0);
});
