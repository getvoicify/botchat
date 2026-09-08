import { test, expect } from "./fixtures";
import { createRoom, postMessage } from "./api";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function connect(base: string) {
  const client = new Client({ name: "botchat-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}
const textOf = (r: any) => r.content.map((c: any) => c.text).join("\n");

test("hands a joining bot the roster and the recent conversation", async ({ server }) => {
  const room = await createRoom(server.url, "standup");
  await postMessage(server.url, room.id, "tom", "shipping today");
  await postMessage(server.url, room.id, "ada", "reviewing today");

  const client = await connect(server.url);
  const joined = textOf(
    await client.callTool({
      name: "join_room",
      arguments: { room_id: room.id, bot_name: "scribe" },
    }),
  );

  expect(joined).toContain("shipping today");
  expect(joined).toContain("tom");
  expect(joined).toContain("ada");
  expect(joined).toContain("2 messages");
  await client.close();
});

test("tells a joining bot the command that keeps it listening", async ({ server }) => {
  const room = await createRoom(server.url, "monitored");
  await postMessage(server.url, room.id, "tom", "hello");
  const client = await connect(server.url);
  const joined = textOf(
    await client.callTool({
      name: "join_room",
      arguments: { room_id: room.id, bot_name: "scribe" },
    }),
  );

  expect(joined).toContain("bin/watch.ts");
  expect(joined).toContain(`--room ${room.id}`);
  expect(joined).toContain("--since 1");
  await client.close();
});

test("shows the joining bot in the room's roster", async ({ server }) => {
  const room = await createRoom(server.url, "roster");
  const client = await connect(server.url);
  await client.callTool({ name: "join_room", arguments: { room_id: room.id, bot_name: "scribe" } });
  const detail = await (await fetch(`${server.url}/api/rooms/${room.id}`)).json();
  expect(detail.participants.map((p: any) => p.name)).toContain("scribe");
  expect(detail.participants.find((p: any) => p.name === "scribe").kind).toBe("bot");
  await client.close();
});

test("lets a bot rejoin after a restart without a name conflict", async ({ server }) => {
  const room = await createRoom(server.url, "rejoin");
  const client = await connect(server.url);
  const args = { room_id: room.id, bot_name: "scribe" };
  const first = await client.callTool({ name: "join_room", arguments: args });
  const second = await client.callTool({ name: "join_room", arguments: args });
  expect(first.isError).toBeFalsy();
  expect(second.isError).toBeFalsy();
  const detail = await (await fetch(`${server.url}/api/rooms/${room.id}`)).json();
  expect(detail.participants.filter((p: any) => p.name === "scribe")).toHaveLength(1);
  await client.close();
});
