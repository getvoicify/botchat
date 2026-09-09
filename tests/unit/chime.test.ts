import { test, expect } from "bun:test";
import { CHIME_GAP_MS, createChime, shouldChime, type ChimeInput } from "../../src/web/chime.ts";

const sounding: ChimeInput = {
  author: "ada",
  me: "tom",
  focused: false,
  muted: false,
  now: 10_000,
  lastPlayedAt: 0,
};

test("sounds when someone else posts while the tab is not focused", () => {
  expect(shouldChime(sounding)).toBe(true);
});

test("stays silent while the tab has focus", () => {
  expect(shouldChime({ ...sounding, focused: true })).toBe(false);
});

test("stays silent for your own message", () => {
  expect(shouldChime({ ...sounding, author: "tom" })).toBe(false);
});

test("stays silent when muted", () => {
  expect(shouldChime({ ...sounding, muted: true })).toBe(false);
});

test("stays silent for a second message inside the gap", () => {
  expect(shouldChime({ ...sounding, lastPlayedAt: sounding.now - CHIME_GAP_MS + 1 })).toBe(false);
});

test("sounds again once the gap has passed", () => {
  expect(shouldChime({ ...sounding, lastPlayedAt: sounding.now - CHIME_GAP_MS })).toBe(true);
});

test("sounds for a different author with the same prefix", () => {
  expect(shouldChime({ ...sounding, author: "tommy" })).toBe(true);
});

type Recorded = { contexts: number; resumes: number; started: number[]; gainValues: number[] };

function installFakeAudio(state: "running" | "suspended" = "running"): Recorded {
  const recorded: Recorded = { contexts: 0, resumes: 0, started: [], gainValues: [] };
  class FakeContext {
    state = state;
    currentTime = 0;
    destination = {};
    constructor() {
      recorded.contexts += 1;
    }
    resume() {
      recorded.resumes += 1;
      return Promise.resolve();
    }
    createGain() {
      const record = (value: number) => recorded.gainValues.push(value);
      return {
        gain: { setValueAtTime: record, exponentialRampToValueAtTime: record },
        connect: (node: unknown) => node,
      };
    }
    createOscillator() {
      return {
        type: "sine",
        frequency: { value: 0 },
        connect: (node: unknown) => node,
        start: (at: number) => recorded.started.push(at),
        stop: () => {},
      };
    }
  }
  Object.defineProperty(globalThis, "AudioContext", {
    value: FakeContext,
    configurable: true,
    writable: true,
  });
  return recorded;
}

test("does not open an audio context until the first chime plays", () => {
  const recorded = installFakeAudio();
  const chime = createChime();
  expect(recorded.contexts).toBe(0);
  chime.play();
  expect(recorded.contexts).toBe(1);
});

test("reuses one audio context across chimes", () => {
  const recorded = installFakeAudio();
  const chime = createChime();
  chime.play();
  chime.play();
  expect(recorded.contexts).toBe(1);
});

test("resumes a context the browser suspended", () => {
  const recorded = installFakeAudio("suspended");
  createChime().play();
  expect(recorded.resumes).toBe(1);
});

test("sounds two tones, the second after the first", () => {
  const recorded = installFakeAudio();
  createChime().play();
  expect(recorded.started).toHaveLength(2);
  expect(recorded.started[1]!).toBeGreaterThan(recorded.started[0]!);
});

test("keeps every gain value above zero, which an exponential ramp requires", () => {
  const recorded = installFakeAudio();
  createChime().play();
  expect(recorded.gainValues.length).toBeGreaterThan(0);
  expect(recorded.gainValues.filter((value) => value <= 0)).toEqual([]);
});
