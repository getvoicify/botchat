import { test, expect } from "bun:test";
import { relativeTime } from "../../src/web/time.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Local constructors, not ISO strings: the formatter reads local calendar fields,
// so a UTC fixture would render a different day either side of the date line.
const now = new Date(2026, 8, 10, 15, 30, 0).getTime();

const ago = (elapsed: number) => relativeTime(now - elapsed, now);

test("reads as just now for a message posted a moment ago", () => {
  expect(ago(3 * SECOND)).toBe("just now");
});

test("still reads as just now at 44 seconds", () => {
  expect(ago(44 * SECOND)).toBe("just now");
});

test("reads as one minute at 45 seconds, the first tick past just now", () => {
  expect(ago(45 * SECOND)).toBe("1m");
});

test("reads as one minute at exactly 60 seconds", () => {
  expect(ago(MINUTE)).toBe("1m");
});

test("reads as 59 minutes just before the hour", () => {
  expect(ago(HOUR - SECOND)).toBe("59m");
});

test("reads as one hour at exactly an hour", () => {
  expect(ago(HOUR)).toBe("1h");
});

test("reads as 23 hours just before a day", () => {
  expect(ago(DAY - SECOND)).toBe("23h");
});

test("reads as one day at exactly 24 hours", () => {
  expect(ago(DAY)).toBe("1d");
});

test("reads as 6 days just before a week", () => {
  expect(ago(WEEK - SECOND)).toBe("6d");
});

test("falls back to a date at a week old", () => {
  expect(ago(WEEK)).toBe("3 Sep");
});

test("includes the year for a message from a different year", () => {
  expect(relativeTime(new Date(2025, 8, 12, 9, 0, 0).getTime(), now)).toBe("12 Sep 2025");
});

test("reads as just now for a timestamp in the future", () => {
  expect(relativeTime(now + SECOND, now)).toBe("just now");
});

test("reads as just now for a timestamp far into the future", () => {
  expect(relativeTime(now + WEEK, now)).toBe("just now");
});
