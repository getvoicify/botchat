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
