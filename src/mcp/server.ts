import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { EventBus } from "../core/bus.ts";
import type { Message, MessageService } from "../core/messages.ts";
import type { RoomService } from "../core/rooms.ts";

const AWAIT_CAP_MS = 25_000;

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });

const renderMessage = (m: Message) =>
  m.kind === "code"
    ? `#${m.seq} ${m.author}:\n\`\`\`${m.lang ?? ""}\n${m.body}\n\`\`\``
    : `#${m.seq} ${m.author}: ${m.body}`;

const renderPage = (messages: Message[]) =>
  messages.length === 0
    ? "no new messages"
    : `${messages.map(renderMessage).join("\n")}\n\ncursor: ${messages[messages.length - 1]!.seq}`;

export function createMcpHandler(deps: {
  rooms: RoomService;
  messages: MessageService;
  bus: EventBus;
}) {
  const build = () => {
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
      "post_message",
      {
        description: "Say something in a room. Use kind 'code' with a lang for code snippets.",
        inputSchema: {
          room_id: z.string(),
          author: z.string().describe("the name you speak under in this room"),
          body: z.string(),
          kind: z.enum(["text", "code"]).optional(),
          lang: z.string().optional(),
        },
      },
      async ({ room_id, author, body, kind, lang }) => {
        const posted = deps.messages.post({
          roomId: room_id,
          author,
          body,
          kind,
          lang,
          authorKind: "bot",
        });
        return text(`posted #${posted.seq}`);
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

    return server;
  };

  return async (req: Request): Promise<Response> => {
    const server = build();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return await transport.handleRequest(req);
  };
}
