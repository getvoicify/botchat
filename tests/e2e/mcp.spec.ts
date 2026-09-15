import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function connect(base: string) {
  const client = new Client({ name: "botchat-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}

const textOf = (result: any) => result.content.map((c: any) => c.text).join("\n");

test("advertises the tools a bot needs to hold a conversation", async ({ server }) => {
  const client = await connect(server.url);
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  expect(names).toEqual(
    [
      "await_messages",
      "create_room",
      "get_messages",
      "join_room",
      "list_attachments",
      "list_memories",
      "list_rooms",
      "pin_memory",
      "post_message",
      "read_attachment",
      "search_memories",
      "unpin_memory",
    ].sort(),
  );
  await client.close();
});

test("creates a room that the web api can then see", async ({ server }) => {
  const client = await connect(server.url);
  await client.callTool({ name: "create_room", arguments: { name: "made by a bot" } });
  const rooms = await (await fetch(`${server.url}/api/rooms`)).json();
  expect(rooms.map((r: any) => r.name)).toContain("made by a bot");
  await client.close();
});

test("shows a bot's message in the browser", async ({ page, server }) => {
  const room = await createRoom(server.url, "bot speaks");
  await page.goto(`${server.url}/rooms/${room.id}?as=tom`);
  await expect(page.getByTestId("transcript")).toHaveAttribute("data-connection", "open");

  const client = await connect(server.url);
  await client.callTool({
    name: "post_message",
    arguments: { room_id: room.id, author: "ada", body: "posted over mcp" },
  });

  await expect(page.getByTestId("transcript")).toContainText("posted over mcp");
  await expect(page.getByTestId("transcript")).toContainText("ada");
  await client.close();
});

test("records a bot as a bot rather than a person", async ({ server }) => {
  const room = await createRoom(server.url, "roster");
  const client = await connect(server.url);
  await client.callTool({
    name: "post_message",
    arguments: { room_id: room.id, author: "ada", body: "beep" },
  });
  const detail = await (await fetch(`${server.url}/api/rooms/${room.id}`)).json();
  expect(detail.participants.find((p: any) => p.name === "ada").kind).toBe("bot");
  await client.close();
});

test("reads back the history a bot did not witness", async ({ server }) => {
  const room = await createRoom(server.url, "history");
  await postMessage(server.url, room.id, "tom", "first");
  await postMessage(server.url, room.id, "tom", "second");

  const client = await connect(server.url);
  const result = await client.callTool({
    name: "get_messages",
    arguments: { room_id: room.id, since: 0 },
  });
  expect(textOf(result)).toContain("first");
  expect(textOf(result)).toContain("second");
  await client.close();
});

test("wakes a waiting bot when a person posts", async ({ server }) => {
  const room = await createRoom(server.url, "wakeup");
  const client = await connect(server.url);

  const waiting = client.callTool({
    name: "await_messages",
    arguments: { room_id: room.id, since: 0, timeout_ms: 20_000 },
  });
  await new Promise((r) => setTimeout(r, 300));
  const started = Date.now();
  await postMessage(server.url, room.id, "tom", "wake up");

  const result = await waiting;
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(textOf(result)).toContain("wake up");
  await client.close();
});

test("returns empty rather than erroring when nothing arrives before the timeout", async ({
  server,
}) => {
  const room = await createRoom(server.url, "quiet");
  const client = await connect(server.url);
  const result = await client.callTool({
    name: "await_messages",
    arguments: { room_id: room.id, since: 0, timeout_ms: 400 },
  });
  expect(result.isError).toBeFalsy();
  expect(textOf(result)).toMatch(/no new messages/i);
  await client.close();
});
