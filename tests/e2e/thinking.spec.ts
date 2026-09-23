import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test.use({ serverEnv: { BOTCHAT_THINKING_TTL_MS: "600" } });

async function connect(base: string) {
  const client = new Client({ name: "botchat-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}

test("shows a bot as thinking once it marks itself, and stops once it posts", async ({
  page,
  server,
}) => {
  const room = await createRoom(server.url, "thinking");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");

  const client = await connect(server.url);
  await client.callTool({
    name: "set_thinking",
    arguments: { room_id: room.id, author: "ada" },
  });
  await expect(page.getByTestId("thinking")).toHaveText("ada is thinking…");

  await client.callTool({
    name: "post_message",
    arguments: { room_id: room.id, author: "ada", body: "here's my reply" },
  });
  await expect(page.getByTestId("thinking")).toHaveCount(0);
  await client.close();
});

test("clears a thinking bot on its own after the timeout, if it never posts", async ({
  page,
  server,
}) => {
  const room = await createRoom(server.url, "abandoned thought");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");

  const client = await connect(server.url);
  await client.callTool({
    name: "set_thinking",
    arguments: { room_id: room.id, author: "ada" },
  });
  await expect(page.getByTestId("thinking")).toHaveText("ada is thinking…");
  await expect(page.getByTestId("thinking")).toHaveCount(0, { timeout: 2_000 });
  await client.close();
});

test("names every bot that is thinking at once", async ({ page, server }) => {
  const room = await createRoom(server.url, "crowded thought");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");

  const client = await connect(server.url);
  await client.callTool({ name: "set_thinking", arguments: { room_id: room.id, author: "ada" } });
  await client.callTool({ name: "set_thinking", arguments: { room_id: room.id, author: "bo" } });
  await expect(page.getByTestId("thinking")).toHaveText("ada and bo are thinking…");
  await client.close();
});

// Every other spec here opens the page first, so the live subscription serves
// them all and the snapshot sent at socket open is never exercised. This is the
// one that reaches it: a browser arriving in the middle of someone's thought.
// It needs the real TTL back — the file's 600 ms is short enough that a page
// load under load could outrun the thought it is meant to find.
test.describe(() => {
  test.use({ serverEnv: { BOTCHAT_THINKING_TTL_MS: "60000" } });

  test("tells a browser who is already thinking when it arrives", async ({ page, server }) => {
    const room = await createRoom(server.url, "thought in progress");

    const client = await connect(server.url);
    await client.callTool({ name: "set_thinking", arguments: { room_id: room.id, author: "ada" } });

    await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
    await expect(page.getByTestId("thinking")).toHaveText("ada is thinking…");
    await client.close();
  });
});

test("does not count a human's typing as anyone thinking", async ({ page, server }) => {
  const room = await createRoom(server.url, "human speaks");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");
  await postMessage(server.url, room.id, "tom", "hi there");
  await expect(page.getByTestId("transcript")).toContainText("hi there");
  await expect(page.getByTestId("thinking")).toHaveCount(0);
});
