import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

const RICH = "**bold** and a list:\n\n- one\n- two\n\n```ts\nconst x = 1;\n```";

const STATUS_TABLE = [
  "here is where we are:",
  "",
  "| step | tokens | status |",
  "| --- | ---: | --- |",
  "| collect the transcript | **231** | done |",
  "| re-render the room | 88 | pending |",
].join("\n");

test("renders a bot's markdown message as formatted text, not raw asterisks", async ({
  page,
  server,
}) => {
  const room = await createRoom(server.url, "markdown");
  await postMessage(server.url, room.id, "ada", RICH, { authorKind: "bot" });
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  const transcript = page.getByTestId("transcript");
  await expect(transcript.locator("strong")).toHaveText("bold");
  await expect(transcript.locator("ul > li")).toHaveText(["one", "two"]);
  await expect(transcript.locator("pre code")).toContainText("const x = 1;");
  await expect(transcript.locator("pre .hljs-keyword").first()).toHaveText("const");
  await expect(transcript).not.toContainText("**bold**");
  await expect(transcript).not.toContainText("```");
});

test("shows a bot's status table as a table, not as pipes", async ({ page, server }) => {
  const room = await createRoom(server.url, "status");
  await postMessage(server.url, room.id, "ada", STATUS_TABLE, { authorKind: "bot" });
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  const transcript = page.getByTestId("transcript");
  await expect(transcript.locator("table thead th")).toHaveText(["step", "tokens", "status"]);
  await expect(transcript.locator("table tbody tr")).toHaveCount(2);
  await expect(transcript.locator("table td strong")).toHaveText("231");

  const paragraphs = await transcript.locator("p").allTextContents();
  expect(paragraphs.filter((text) => text.trimStart().startsWith("|"))).toEqual([]);
});

test("copies a code block to the clipboard", async ({ page, context, server }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const room = await createRoom(server.url, "copy");
  await postMessage(server.url, room.id, "ada", "print('hi')", {
    kind: "code",
    lang: "python",
    authorKind: "bot",
  });
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  await page.getByRole("button", { name: "Copy" }).click();

  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("print('hi')");
});
