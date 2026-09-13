import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";

async function roomWith(url: string, people: string[]) {
  const room = await createRoom(url, "mentions");
  for (const name of people) {
    await postMessage(url, room.id, name, "here", name === "tom" ? {} : { authorKind: "bot" });
  }
  return room;
}

test("renders a mention of a participant as a chip", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom", "grace"]);
  await postMessage(server.url, room.id, "ada", "@grace can you look at the log?", {
    authorKind: "bot",
  });
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  const chip = page.getByTestId("transcript").locator(".mention");
  await expect(chip).toHaveText("@grace");
  await expect(chip).not.toHaveClass(/mention-you/);
});

test("leaves an unknown name as plain text", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom"]);
  await postMessage(server.url, room.id, "ada", "@nobody are you there?", { authorKind: "bot" });
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  const transcript = page.getByTestId("transcript");
  await expect(transcript).toContainText("@nobody are you there?");
  await expect(transcript.locator(".mention")).toHaveCount(0);
});

test("leaves an @name inside a code block alone", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom", "ada"]);
  await postMessage(
    server.url,
    room.id,
    "ada",
    'so @ada owns it:\n\n```ts\n// @ada owns this handler\nconst to = "ada@example.com";\n```',
    { authorKind: "bot" },
  );
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  const transcript = page.getByTestId("transcript");
  await expect(transcript.locator(".mention")).toHaveCount(1);
  await expect(transcript.locator("pre")).toContainText("// @ada owns this handler");
  await expect(transcript.locator("pre .mention")).toHaveCount(0);
});

test("leaves an @name inside inline code alone", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom", "ada"]);
  await postMessage(server.url, room.id, "ada", "the header reads `to @ada` verbatim", {
    authorKind: "bot",
  });
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  const transcript = page.getByTestId("transcript");
  await expect(transcript.locator("code")).toHaveText("to @ada");
  await expect(transcript.locator(".mention")).toHaveCount(0);
});

test("marks a mention of you differently", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom", "grace"]);
  await postMessage(server.url, room.id, "ada", "@tom and @grace, both of you", {
    authorKind: "bot",
  });
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  const chips = page.getByTestId("transcript").locator(".mention");
  await expect(chips).toHaveCount(2);
  await expect(chips.filter({ hasText: "@tom" })).toHaveClass(/mention-you/);
  await expect(chips.filter({ hasText: "@grace" })).not.toHaveClass(/mention-you/);
});

const composerOf = (page: import("@playwright/test").Page) => page.getByLabel("Message");

test("lists the participants matching what has been typed, prefix matches first", async ({
  page,
  server,
}) => {
  const room = await roomWith(server.url, ["tom", "ada", "grace"]);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const composer = composerOf(page);
  await composer.click();
  await composer.pressSequentially("@a");

  await expect(page.getByRole("option")).toHaveText(["ada", "grace"]);
  await expect(composer).toHaveAttribute("aria-expanded", "true");
});

test("does not send the message when Enter picks a mention", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom", "ada"]);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const composer = composerOf(page);
  await composer.click();
  await composer.pressSequentially("@a");
  await expect(page.getByRole("option", { name: "ada" })).toBeVisible();

  await composer.press("Enter");

  await expect(composer).toHaveValue("@ada ");
  await expect(page.getByTestId("transcript").locator("li.message")).toHaveCount(2);
});

test("sends normally once the mention list is dismissed", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom", "ada"]);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const composer = composerOf(page);
  await composer.click();
  await composer.pressSequentially("@a");
  await expect(page.getByRole("listbox")).toBeVisible();

  await composer.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await composer.pressSequentially(" hello");
  await composer.press("Enter");

  await expect(page.getByTestId("transcript")).toContainText("@a hello");
  await expect(composer).toHaveValue("");
});

test("moves the highlight with the arrow keys", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom", "ada", "grace"]);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const composer = composerOf(page);
  await composer.click();
  await composer.pressSequentially("@a");
  await expect(page.getByRole("option", { name: "ada" })).toHaveAttribute("aria-selected", "true");

  await composer.press("ArrowDown");

  await expect(page.getByRole("option", { name: "grace" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await composer.press("Enter");
  await expect(composer).toHaveValue("@grace ");
});

test("picks the highlighted participant with Tab", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom", "ada"]);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const composer = composerOf(page);
  await composer.click();
  await composer.pressSequentially("@ad");
  await expect(page.getByRole("option", { name: "ada" })).toBeVisible();

  await composer.press("Tab");

  await expect(composer).toHaveValue("@ada ");
});

test("completes a mention typed part way through a sentence", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom", "ada"]);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const composer = composerOf(page);
  await composer.click();
  await composer.pressSequentially("morning @ad");
  await expect(page.getByRole("option", { name: "ada" })).toBeVisible();
  await composer.press("Enter");
  await expect(composer).toHaveValue("morning @ada ");

  await composer.pressSequentially("any news?");
  await composer.press("Enter");

  await expect(page.getByTestId("transcript").locator(".mention")).toHaveText("@ada");
});

test("does not offer your own name", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom", "ada"]);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const composer = composerOf(page);
  await composer.click();
  await composer.pressSequentially("@");

  await expect(page.getByRole("option")).toHaveText(["ada"]);
});

test("does not open the list when only your own name matches", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom", "ada"]);
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  const composer = composerOf(page);
  await composer.click();
  await composer.pressSequentially("@a");
  await expect(page.getByRole("listbox")).toBeVisible();

  await composer.press("Backspace");
  await composer.pressSequentially("to");

  await expect(composer).toHaveValue("@to");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(composer).toHaveAttribute("aria-expanded", "false");
});

test("still shows a mention of you from someone else", async ({ page, server }) => {
  const room = await roomWith(server.url, ["tom", "ada"]);
  await postMessage(server.url, room.id, "ada", "@tom take a look", { authorKind: "bot" });
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);

  const chip = page.getByTestId("transcript").locator(".mention");
  await expect(chip).toHaveText("@tom");
  await expect(chip).toHaveClass(/mention-you/);
});
