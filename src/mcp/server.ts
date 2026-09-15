import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { BlobStore } from "../core/blobs.ts";
import type { EventBus } from "../core/bus.ts";
import type { Memory, MemoryService } from "../core/memories.ts";
import type { Message, MessageService } from "../core/messages.ts";
import type { RoomService } from "../core/rooms.ts";
import { digest } from "../core/summary.ts";
import type { Store } from "../db/store.ts";

const AWAIT_CAP_MS = 25_000;
const INLINE_TEXT_CAP = 256 * 1024;

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });

const isTextish = (mime: string) =>
  mime.startsWith("text/") || /^application\/(json|xml|javascript|x-yaml)\b|\+(json|xml)\b/.test(mime);

const renderAttachments = (m: Message) =>
  m.attachments.map((a) => `\n  [file] ${a.filename} (${a.mime}, ${a.size} bytes) ${a.blobId}`).join("");

const renderMessage = (m: Message) =>
  (m.kind === "code"
    ? `#${m.seq} ${m.author}:\n\`\`\`${m.lang ?? ""}\n${m.body}\n\`\`\``
    : `#${m.seq} ${m.author}: ${m.body}`) + renderAttachments(m);

const renderPage = (messages: Message[]) =>
  messages.length === 0
    ? "no new messages"
    : `${messages.map(renderMessage).join("\n")}\n\ncursor: ${messages[messages.length - 1]!.seq}`;

const renderMemory = (memory: Memory, excerpt?: string) =>
  [
    memory.id,
    `  note: ${memory.note}`,
    `  pinned by ${memory.pinnedBy} on ${new Date(memory.createdAt).toISOString()}`,
    ...(excerpt ? [`  match: ${excerpt}`] : []),
    ...memory.messages.map((m) => `  #${m.seq} ${m.author}: ${m.body}`),
  ].join("\n");

export function createMcpHandler(deps: {
  store: Store;
  rooms: RoomService;
  messages: MessageService;
  memories: MemoryService;
  bus: EventBus;
  blobs: BlobStore;
}) {
  const build = (origin: string) => {
    const server = new McpServer({ name: "botchat", version: "1.0.0" });

    server.registerTool(
      "list_rooms",
      { description: "List every chat room, newest first, with its message count." },
      async () =>
        text(
          deps.rooms
            .list()
            .map((r) => `${r.id}  ${r.name}  (${deps.messages.count(r.id)} messages)`)
            .join("\n") || "no rooms yet",
        ),
    );

    server.registerTool(
      "create_room",
      {
        description: "Start a new chat room.",
        inputSchema: { name: z.string(), topic: z.string().optional() },
      },
      async ({ name, topic }) => {
        const room = deps.rooms.create({ name, topic });
        return text(`created room ${room.id} (${room.name})`);
      },
    );

    server.registerTool(
      "join_room",
      {
        description:
          "Join a room under a name and receive a summary of what has been said so far.",
        inputSchema: {
          room_id: z.string(),
          bot_name: z.string().describe("the name you will speak under in this room"),
        },
      },
      async ({ room_id, bot_name }) => {
        const participant = deps.rooms.join(room_id, bot_name, "bot");
        const { text: summary, cursor } = digest(deps, room_id);
        return text(
          [
            `You joined ${participant.roomId} as ${participant.name}.`,
            "",
            summary,
            "",
            `To stay in this conversation, run this now as a background monitor: bun bin/watch.ts --room ${participant.roomId} --since ${cursor}. Each new message arrives as one JSON line.`,
          ].join("\n"),
        );
      },
    );

    server.registerTool(
      "post_message",
      {
        description: "Say something in a room. Use kind 'code' with a lang for code snippets.",
        inputSchema: {
          room_id: z.string(),
          author: z.string().describe("the name you speak under in this room"),
          body: z.string(),
          kind: z.enum(["text", "code"]).optional(),
          lang: z.string().optional(),
          attachments: z
            .array(z.object({ blob_id: z.string(), filename: z.string() }))
            .optional()
            .describe("files already uploaded to POST /api/blobs"),
        },
      },
      async ({ room_id, author, body, kind, lang, attachments }) => {
        const posted = deps.messages.post({
          roomId: room_id,
          author,
          body,
          kind,
          lang,
          authorKind: "bot",
          attachments: attachments?.map((a) => ({ blobId: a.blob_id, filename: a.filename })),
        });
        return text(`posted #${posted.seq}`);
      },
    );

    server.registerTool(
      "list_attachments",
      {
        description: "List every file shared in a room, with the blob id needed to read it.",
        inputSchema: { room_id: z.string() },
      },
      async ({ room_id }) => {
        deps.rooms.get(room_id);
        const files = deps.store.attachmentManifest(room_id);
        return text(
          files
            .map((f) => `${f.blobId}  ${f.filename}  (${f.mime}, ${f.size} bytes)  in #${f.messageSeq}`)
            .join("\n") || "no files shared yet",
        );
      },
    );

    server.registerTool(
      "read_attachment",
      {
        description:
          "Read a file shared in a room. Returns its text when it is textual, otherwise a URL to fetch.",
        inputSchema: { blob_id: z.string() },
      },
      async ({ blob_id }) => {
        const { file, record } = await deps.blobs.open(blob_id);
        const header = `${record.mime}, ${record.size} bytes`;
        if (!isTextish(record.mime) || record.size > INLINE_TEXT_CAP)
          return text(`${header}\nfetch it from ${origin}/api/blobs/${record.id}`);
        return text(`${header}\n\n${await file.text()}`);
      },
    );

    server.registerTool(
      "get_messages",
      {
        description: "Read a room's history. Page forwards with since, backwards with before.",
        inputSchema: {
          room_id: z.string(),
          since: z.number().optional(),
          before: z.number().optional(),
          limit: z.number().optional(),
        },
      },
      async ({ room_id, since, before, limit }) => {
        const page =
          before !== undefined
            ? deps.messages.before(room_id, before, limit)
            : since !== undefined
              ? deps.messages.since(room_id, since, limit)
              : deps.messages.latest(room_id, limit);
        return text(renderPage(page));
      },
    );

    server.registerTool(
      "await_messages",
      {
        description:
          "Block until someone posts after `since`, or the timeout elapses. Prefer running the watcher as a background monitor; use this when you cannot.",
        inputSchema: {
          room_id: z.string(),
          since: z.number(),
          timeout_ms: z.number().optional(),
        },
      },
      // The backlog read and the subscribe run with no await between them, so a
      // message committing in the gap cannot be missed.
      async ({ room_id, since, timeout_ms }) => {
        deps.rooms.get(room_id);
        const backlog = deps.messages.since(room_id, since);
        if (backlog.length > 0) return text(renderPage(backlog));
        await deps.bus.once(room_id, Math.min(timeout_ms ?? 20_000, AWAIT_CAP_MS));
        return text(renderPage(deps.messages.since(room_id, since)));
      },
    );

    server.registerTool(
      "pin_memory",
      {
        description:
          "Pin an exchange as an important memory of this room, with a note saying why it will matter later. For decisions, conclusions and constraints a bot joining next month would need to know — not for ordinary conversation.",
        inputSchema: {
          room_id: z.string(),
          author: z.string().describe("the name you speak under in this room"),
          message_seqs: z.array(z.number()).describe("the seqs of the messages worth keeping"),
          note: z.string().describe("why this exchange will matter later"),
        },
      },
      async ({ room_id, author, message_seqs, note }) => {
        const memory = deps.memories.pin({
          roomId: room_id,
          author,
          messageSeqs: message_seqs,
          note,
        });
        return text(`pinned as an important memory:\n${renderMemory(memory)}`);
      },
    );

    server.registerTool(
      "search_memories",
      {
        description:
          "Search this room's important memories. Matches the notes and the pinned messages themselves. Plain words; no operators needed.",
        inputSchema: { room_id: z.string(), query: z.string(), limit: z.number().optional() },
      },
      async ({ room_id, query, limit }) => {
        const hits = deps.memories.search(room_id, query, limit);
        return text(
          hits.map((hit) => renderMemory(hit, hit.excerpt)).join("\n\n") ||
            "no memories match that",
        );
      },
    );

    server.registerTool(
      "list_memories",
      {
        description: "List this room's important memories, most recently pinned first.",
        inputSchema: { room_id: z.string(), limit: z.number().optional() },
      },
      async ({ room_id, limit }) =>
        text(
          deps.memories
            .list(room_id, limit)
            .map((memory) => renderMemory(memory))
            .join("\n\n") || "no memories pinned yet",
        ),
    );

    server.registerTool(
      "unpin_memory",
      {
        description:
          "Drop a memory that no longer holds, so it stops turning up in searches. The room's history is untouched.",
        inputSchema: {
          memory_id: z.string(),
          reason: z.string().optional().describe("what superseded it, for the reply only"),
        },
      },
      async ({ memory_id, reason }) => {
        const memory = deps.memories.unpin(memory_id);
        return text(
          `unpinned ${memory.id}${reason ? ` — ${reason}` : ""}\n  it read: ${memory.note}`,
        );
      },
    );

    return server;
  };

  return async (req: Request): Promise<Response> => {
    const server = build(new URL(req.url).origin);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return await transport.handleRequest(req);
  };
}
