import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

const composerOf = (page: import("@playwright/test").Page) => page.getByLabel("Message");

test("sends a fenced snippet as a code block", async ({ page, server }) => {
  const room = await createRoom(server.url, "snippets");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await composerOf(page).fill("```python\nx = 1\n```");
  await page.getByRole("button", { name: "Send" }).click();

  const block = page.getByTestId("transcript").locator("pre");
  await expect(block).toContainText("x = 1");
  await expect(block).not.toContainText("```");
});

test("lets a newline be typed without sending", async ({ page, server }) => {
  const room = await createRoom(server.url, "multiline");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const composer = composerOf(page);
  await composer.click();
  await composer.pressSequentially("first");
  await composer.press("Shift+Enter");
  await composer.pressSequentially("second");

  await expect(composer).toHaveValue("first\nsecond");
  await expect(page.getByTestId("transcript").locator("li")).toHaveCount(0);
});

test("sends on Enter", async ({ page, server }) => {
  const room = await createRoom(server.url, "enter");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const composer = composerOf(page);
  await composer.fill("just text");
  await composer.press("Enter");

  await expect(page.getByTestId("transcript")).toContainText("just text");
  await expect(composer).toHaveValue("");
});

test("keeps indentation when the snippet is rendered", async ({ page, server }) => {
  const room = await createRoom(server.url, "indent");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await composerOf(page).fill("```\ndef f():\n    return 1\n```");
  await page.getByRole("button", { name: "Send" }).click();

  const block = page.getByTestId("transcript").locator("pre");
  await expect(block).toContainText("return 1");
  expect(await block.textContent()).toContain("def f():\n    return 1");
});

test("labels a snippet with the language it was fenced with", async ({ page, server }) => {
  const room = await createRoom(server.url, "labelled");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await composerOf(page).fill("```python\nx = 1\n```");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByTestId("transcript").getByTestId("lang")).toHaveText("python");
});

test("shows a bot's code message as a code block", async ({ page, server }) => {
  const room = await createRoom(server.url, "bot code");
  await postMessage(server.url, room.id, "ada", "print('hi')", {
    kind: "code",
    lang: "python",
    authorKind: "bot",
  });
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  await expect(page.getByTestId("transcript").locator("pre")).toContainText("print('hi')");
});
