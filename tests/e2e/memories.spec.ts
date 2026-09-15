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

test("pins an exchange and finds it again by searching its note", async ({ server }) => {
  const room = await createRoom(server.url, "design");
  const question = await postMessage(server.url, room.id, "tom", "do we cache the feed?");
  const answer = await postMessage(server.url, room.id, "ada", "yes, for sixty seconds");

  const client = await connect(server.url);
  await client.callTool({
    name: "pin_memory",
    arguments: {
      room_id: room.id,
      author: "scribe",
      message_seqs: [question.seq, answer.seq],
      note: "the caching decision",
    },
  });

  const found = textOf(
    await client.callTool({
      name: "search_memories",
      arguments: { room_id: room.id, query: "caching" },
    }),
  );
  expect(found).toContain("the caching decision");
  expect(found).toContain("yes, for sixty seconds");
  expect(found).toContain(`#${answer.seq}`);
  await client.close();
});

test("finds a memory by words that appear only in the pinned messages", async ({ server }) => {
  const room = await createRoom(server.url, "delivery");
  const posted = await postMessage(
    server.url,
    room.id,
    "ada",
    "we fall back to the origin whenever the edge is cold",
  );

  const client = await connect(server.url);
  await client.callTool({
    name: "pin_memory",
    arguments: {
      room_id: room.id,
      author: "scribe",
      message_seqs: [posted.seq],
      note: "read before touching delivery",
    },
  });

  const found = textOf(
    await client.callTool({
      name: "search_memories",
      arguments: { room_id: room.id, query: "cold edge" },
    }),
  );
  expect(found).toContain("read before touching delivery");
  await client.close();
});

test("does not return a memory that was unpinned", async ({ server }) => {
  const room = await createRoom(server.url, "reversals");
  const posted = await postMessage(server.url, room.id, "tom", "sixty seconds");

  const client = await connect(server.url);
  const pin = async (note: string) =>
    textOf(
      await client.callTool({
        name: "pin_memory",
        arguments: { room_id: room.id, author: "scribe", message_seqs: [posted.seq], note },
      }),
    );
  const kept = await pin("the caching decision stands");
  const dropped = await pin("the caching decision we reversed");
  const droppedId = dropped.match(/[0-9a-f-]{36}/)![0];

  await client.callTool({
    name: "unpin_memory",
    arguments: { memory_id: droppedId, reason: "superseded" },
  });

  const found = textOf(
    await client.callTool({
      name: "search_memories",
      arguments: { room_id: room.id, query: "caching" },
    }),
  );
  expect(found).toContain("the caching decision stands");
  expect(found).not.toContain("we reversed");
  expect(kept).toContain("stands");
  await client.close();
});

test("refuses to pin a message from another room", async ({ server }) => {
  const ours = await createRoom(server.url, "ours");
  const theirs = await createRoom(server.url, "theirs");
  await postMessage(server.url, ours.id, "tom", "our decision");
  const secret = await postMessage(server.url, theirs.id, "eve", "the launch password is hunter2");

  const client = await connect(server.url);
  const result = await client.callTool({
    name: "pin_memory",
    arguments: {
      room_id: ours.id,
      author: "scribe",
      message_seqs: [secret.seq],
      note: "reaching across",
    },
  });

  expect(result.isError).toBeTruthy();
  const listed = textOf(
    await client.callTool({ name: "list_memories", arguments: { room_id: ours.id } }),
  );
  expect(listed).toMatch(/no memories/i);
  const searched = textOf(
    await client.callTool({
      name: "search_memories",
      arguments: { room_id: ours.id, query: "password" },
    }),
  );
  expect(searched).not.toContain("hunter2");
  await client.close();
});

test("shows pinned memories to a bot that joins afterwards", async ({ server }) => {
  const room = await createRoom(server.url, "standup");
  const posted = await postMessage(server.url, room.id, "tom", "we ship on friday");

  const client = await connect(server.url);
  await client.callTool({
    name: "pin_memory",
    arguments: {
      room_id: room.id,
      author: "scribe",
      message_seqs: [posted.seq],
      note: "the ship date nobody may move",
    },
  });

  const joined = textOf(
    await client.callTool({
      name: "join_room",
      arguments: { room_id: room.id, bot_name: "newcomer" },
    }),
  );
  expect(joined).toContain("the ship date nobody may move");
  expect(joined).toContain(`#${posted.seq}`);
  await client.close();
});

test("survives a restart of the server that stored it", async ({ server }) => {
  const room = await createRoom(server.url, "durable");
  const posted = await postMessage(server.url, room.id, "tom", "sixty seconds");

  const before = await connect(server.url);
  await before.callTool({
    name: "pin_memory",
    arguments: {
      room_id: room.id,
      author: "scribe",
      message_seqs: [posted.seq],
      note: "the caching decision",
    },
  });
  await before.close();

  await server.restart();

  const after = await connect(server.url);
  const found = textOf(
    await after.callTool({
      name: "search_memories",
      arguments: { room_id: room.id, query: "caching" },
    }),
  );
  expect(found).toContain("the caching decision");
  await after.close();
});
