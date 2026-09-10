const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const JUST_NOW_MS = 45 * SECOND;

// A fixed table rather than toLocaleDateString: the output is specified as
// "12 Sep", and the default locale differs between the test runner and a
// reader's browser, so a locale-formatted date would be asserted in one form
// and rendered in another.
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function relativeTime(then: number, now: number): string {
  const elapsed = now - then;
  if (elapsed < JUST_NOW_MS) return "just now";
  if (elapsed < HOUR) return `${Math.max(1, Math.floor(elapsed / MINUTE))}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  const at = new Date(then);
  const date = `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  return at.getFullYear() === new Date(now).getFullYear() ? date : `${date} ${at.getFullYear()}`;
}
