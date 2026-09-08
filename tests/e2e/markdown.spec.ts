import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

const RICH = "**bold** and a list:\n\n- one\n- two\n\n```ts\nconst x = 1;\n```";

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
