import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

type Page = import("@playwright/test").Page;

const ROWS = 200;

const PHRASE = "hello there how are you";

const AUTHORS = ["ada", "grace", "turing", "lovelace"];

const LANGS = ["ts", "python", "sql", "go"];

const SENTENCE =
  "the queue drains before the socket reconnects and nobody notices until the digest arrives";

// Close to what the rooms this was reported from actually hold: paragraphs of a
// few sentences, ten-line fenced blocks, short lists. A transcript of one-word
// messages does not re-parse slowly enough to show the defect at all.
function bodyFor(index: number): string {
  const author = AUTHORS[index % AUTHORS.length]!;
  if (index % 7 === 0) {
    const lines = [`export function step${index}(rows: number[]): number {`];
    for (let line = 0; line < 8; line += 1)
      lines.push(`  const part${line} = (rows[${line}] ?? ${line}) * ${index} + ${line};`);
    lines.push("  return rows.length;", "}");
    return [
      `@${author} the repro is in \`step${index}\`, the reduce runs before the guard:`,
      "",
      `\`\`\`${LANGS[index % LANGS.length]}`,
      ...lines,
      "```",
      "",
      `${SENTENCE}, so *every* caller sees it.`,
    ].join("\n");
  }
  if (index % 5 === 0) {
    return [
      `### checkpoint ${index}`,
      "",
      `- ${SENTENCE} at \`seq ${index}\``,
      `- **${author}** has the trace, and the \`cursor\` never moved past ${index}`,
      `- ${SENTENCE}, which is the part nobody expected`,
      "",
      `${SENTENCE}.`,
    ].join("\n");
  }
  return [
    `${SENTENCE}, and \`seq ${index}\` is where *it* landed for @${author}.`,
    `${SENTENCE}, though the **retry** after ${index} covered it.`,
    `${SENTENCE}, see \`room/${index}\` for the rest.`,
  ].join(" ");
}

async function seedRoom(url: string): Promise<string> {
  const room = await createRoom(url, "typing perf");
  for (let index = 0; index < ROWS; index += 1) {
    await postMessage(url, room.id, AUTHORS[index % AUTHORS.length]!, bodyFor(index), {
      authorKind: "bot",
    });
  }
  return room.id;
}

async function watchLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const durations: number[] = [];
    (globalThis as unknown as { __longTasks: number[] }).__longTasks = durations;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    }).observe({ type: "longtask", buffered: false });
  });
}

const longTasksSeen = (page: Page): Promise<number[]> =>
  page.evaluate(() => (globalThis as unknown as { __longTasks: number[] }).__longTasks);

test("typing into the composer does not re-render the transcript", async ({ page, server }) => {
  test.setTimeout(180_000);
  const roomId = await seedRoom(server.url);

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
  console.log(
    `long tasks while typing ${PHRASE.length} characters into a ${ROWS}-row room at 6x: ${longTasks.length}` +
      (longTasks.length
        ? ` (${Math.min(...longTasks).toFixed(0)}–${Math.max(...longTasks).toFixed(0)} ms)`
        : ""),
  );
  expect(longTasks.length).toBeLessThan(5);
});
