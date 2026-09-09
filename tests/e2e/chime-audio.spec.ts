import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

// Chromium suspends every AudioContext until a user gesture, and a suspended
// context is exactly what this spec must not settle for. The relaxed policy is
// a launch argument rather than a page setting, so a file-scoped test.use gives
// this one file its own browser and leaves the rest of the suite on the default
// policy. --mute-audio keeps the graph rendering while detaching it from the
// machine's output device; without it, workers competing for a real device
// crashed the renderer mid-test.
test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] },
});

const CHIME_TONES_HZ = [880, 1175];
const PAST_THE_GAP_MS = 2_500;

type AudioProbe = { tones: number[]; contextState: string; oscillator: string };

type ProbedWindow = Window & { __audio: AudioProbe };

// The stubbed sibling spec swaps AudioContext out and reads back the decision.
// This one wraps it and leaves it in place, so every tone recorded below is
// downstream of a real oscillator, a real pair of gain ramps and a real
// connection to destination — a throw anywhere in that graph reaches the
// assertions as a missing tone.
async function observeRealAudio(page: Page) {
  await page.addInitScript(() => {
    const probe: AudioProbe = { tones: [], contextState: "none", oscillator: "none" };
    (window as unknown as ProbedWindow).__audio = probe;
    document.hasFocus = () => false;
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      const oscillator = createOscillator.call(this);
      probe.contextState = this.state;
      probe.oscillator = oscillator.constructor.name;
      const start = oscillator.start.bind(oscillator);
      oscillator.start = (when?: number) => {
        probe.tones.push(Math.round(oscillator.frequency.value));
        start(when);
      };
      return oscillator;
    };
  });
}

const probe = (page: Page) =>
  page.evaluate(() => (window as unknown as ProbedWindow).__audio) as Promise<AudioProbe>;

const tones = async (page: Page) => (await probe(page)).tones;

test("plays the real chime once and never re-sounds it", async ({ page, server }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const room = await createRoom(server.url, "audible");
  await observeRealAudio(page);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toHaveAttribute("data-connection", "open");

  // Both posts leave in one burst so the second lands inside the 2s gap however
  // slow the machine is; asserting in between costs page round-trips that can
  // themselves outlast the gap.
  await Promise.all([
    postMessage(server.url, room.id, "ada", "first beep", { authorKind: "bot" }),
    postMessage(server.url, room.id, "ada", "hot on its heels", { authorKind: "bot" }),
  ]);
  await expect(transcript).toContainText("first beep");
  await expect(transcript).toContainText("hot on its heels");

  const heard = await probe(page);
  expect(heard.tones).toEqual(CHIME_TONES_HZ);
  expect(heard.oscillator).toBe("OscillatorNode");
  expect(heard.contextState).toBe("running");

  await page.getByLabel("Message").fill("talking to myself");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(transcript).toContainText("talking to myself");
  expect(await tones(page)).toEqual(CHIME_TONES_HZ);

  await page.getByTestId("sound-toggle").click();
  await postMessage(server.url, room.id, "ada", "muted and prompt", { authorKind: "bot" });
  await expect(transcript).toContainText("muted and prompt");
  // The gap has to be spent before the second muted post, or silence proves the
  // rate limit rather than the mute.
  await page.waitForTimeout(PAST_THE_GAP_MS);
  await postMessage(server.url, room.id, "ada", "muted and patient", { authorKind: "bot" });
  await expect(transcript).toContainText("muted and patient");
  expect(await tones(page)).toEqual(CHIME_TONES_HZ);

  expect(pageErrors).toEqual([]);
});
