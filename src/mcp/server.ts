import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { BoardService, TaskPriority } from "../core/board.ts";
import type { BlobStore } from "../core/blobs.ts";
import type { EventBus } from "../core/bus.ts";
import { Invalid, NotFound } from "../core/errors.ts";
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

export function createMcpHandler(deps: {
  store: Store;
  rooms: RoomService;
  messages: MessageService;
  bus: EventBus;
  blobs: BlobStore;
  board: BoardService;
}) {
  const build = (origin: string) => {
    const server = new McpServer({ name: "botchat", version: "1.0.0" });

    // ---- board helpers -------------------------------------------------
    // Agents refer to columns by NAME (how they think: "Done", "Review") and
    // to tasks by id or short #prefix (how get_board renders them).
    const columnByName = (roomId: string, name: string) => {
      const column = deps.board.board(roomId).columns.find((c) => c.name === name);
      if (!column)
        throw new NotFound(
          `no column ${name}; columns are: ${deps.board.board(roomId).columns.map((c) => c.name).join(", ")}`,
        );
      return column;
    };

    const taskById = (roomId: string, ref: string) => {
      const needle = ref.replace(/^#/, "");
      const tasks = deps.board.tasks(roomId);
      const exact = tasks.find((t) => t.id === needle);
      if (exact) return exact;
      const matches = tasks.filter((t) => t.id.startsWith(needle));
      if (matches.length === 1) return matches[0]!;
      if (matches.length > 1) throw new Invalid(`task ${ref} is ambiguous; use a longer prefix`);
      throw new NotFound(`no task ${ref} in room ${roomId}`);
    };

    const shortId = (taskId: string) => `#${taskId.slice(0, 6)}`;

    const renderBoard = (roomId: string) => {
      const { columns, tasks } = deps.board.board(roomId);
      const lines = [`Board (${columns.length} columns, ${tasks.length} tasks):`];
      for (const column of columns) {
        const inColumn = tasks.filter((t) => t.columnId === column.id);
        lines.push(`${column.name} (${inColumn.length}):`);
        for (const task of inColumn) {
          lines.push(
            `  ${shortId(task.id)} ${task.title}` +
              `${task.assignee ? ` — ${task.assignee}` : ""}` +
              `${task.priority !== "none" ? ` [${task.priority}]` : ""}`,
          );
        }
      }
      return text(lines.join("\n"));
    };

    const renderTask = (roomId: string, taskId: string) => {
      const { task, events } = deps.board.task(roomId, taskId);
      const column = deps.board.board(roomId).columns.find((c) => c.id === task.columnId);
      const lines = [
        `${shortId(task.id)} ${task.title}`,
        `column: ${column?.name ?? "?"}  assignee: ${task.assignee ?? "(none)"}  priority: ${task.priority}`,
      ];
      if (task.body) lines.push(`body: ${task.body}`);
      if (events.length > 0)
        lines.push(
          `events: ${events.map((e) => `${e.kind}${e.author ? ` by ${e.author}` : ""}`).join(", ")}`,
        );
      return text(lines.join("\n"));
    };

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

    // ---- board tools ---------------------------------------------------------

    server.registerTool(
      "get_board",
      {
        description:
          "Show the room's kanban board: columns and tasks, with the short task ids used by the other board tools.",
        inputSchema: { room_id: z.string() },
      },
      async ({ room_id }) => {
        deps.rooms.get(room_id);
        return renderBoard(room_id);
      },
    );

    server.registerTool(
      "define_columns",
      {
        description:
          "Add columns to the room's board (idempotent for existing names). A fresh board already has Backlog, In Progress, Review, Done, Blocked; archive the ones you do not need.",
        inputSchema: {
          room_id: z.string(),
          columns: z.array(z.string()).describe("column names to add, in order"),
          author: z.string().optional(),
        },
      },
      async ({ room_id, columns, author }) => {
        deps.rooms.get(room_id);
        const created = deps.board.defineColumns(room_id, columns, author ?? null);
        return text(`added ${created.length} column(s): ${created.map((c) => c.name).join(", ")}`);
      },
    );

    server.registerTool(
      "rename_column",
      {
        description: "Rename a column on the room's board.",
        inputSchema: {
          room_id: z.string(),
          column_name: z.string(),
          new_name: z.string(),
        },
      },
      async ({ room_id, column_name, new_name }) => {
        deps.rooms.get(room_id);
        const renamed = deps.board.renameColumn(room_id, columnByName(room_id, column_name).id, new_name);
        return text(`renamed to ${renamed.name}`);
      },
    );

    server.registerTool(
      "reorder_columns",
      {
        description: "Reorder ALL columns on the room's board; every column name must appear exactly once.",
        inputSchema: {
          room_id: z.string(),
          columns: z.array(z.string()).describe("column names in the desired order"),
        },
      },
      async ({ room_id, columns }) => {
        deps.rooms.get(room_id);
        const byName = new Map(deps.board.board(room_id).columns.map((c) => [c.name, c.id]));
        const ids = columns.map((name) => byName.get(name));
        if (ids.some((id) => id === undefined))
          throw new Invalid(`reorder must list every column exactly once by name`);
        const ordered = deps.board.reorderColumns(room_id, ids as string[]);
        return text(`columns now: ${ordered.map((c) => c.name).join(", ")}`);
      },
    );

    server.registerTool(
      "archive_column",
      {
        description: "Archive a column (only when it has no tasks) so it no longer shows on the board.",
        inputSchema: {
          room_id: z.string(),
          column_name: z.string(),
        },
      },
      async ({ room_id, column_name }) => {
        deps.rooms.get(room_id);
        const archived = deps.board.archiveColumn(room_id, columnByName(room_id, column_name).id);
        return text(`archived ${archived.name}`);
      },
    );

    server.registerTool(
      "create_task",
      {
        description:
          "Create a task on the room's board. Without a column it lands in the first column (Backlog).",
        inputSchema: {
          room_id: z.string(),
          title: z.string(),
          body: z.string().optional(),
          assignee: z.string().optional(),
          column_name: z.string().optional(),
          priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
          author: z.string().optional(),
        },
      },
      async ({ room_id, title, body, assignee, column_name, priority, author }) => {
        deps.rooms.get(room_id);
        const column = column_name ? columnByName(room_id, column_name) : null;
        const task = deps.board.createTask(
          room_id,
          { title, body, assignee, columnId: column?.id ?? null, priority: (priority as TaskPriority | undefined) ?? "none" },
          author ?? null,
        );
        return text(`created ${shortId(task.id)} "${task.title}"`);
      },
    );

    server.registerTool(
      "move_task",
      {
        description:
          "Move a task to another column (by name). Moving into Done completes it; moving out reopens it.",
        inputSchema: {
          room_id: z.string(),
          task_id: z.string().describe("task id or short #prefix from get_board"),
          column_name: z.string(),
          author: z.string().optional(),
        },
      },
      async ({ room_id, task_id, column_name, author }) => {
        deps.rooms.get(room_id);
        const moved = deps.board.moveTask(room_id, taskById(room_id, task_id).id, columnByName(room_id, column_name).id, author ?? null);
        return text(`${shortId(moved.id)} "${moved.title}" → ${column_name}`);
      },
    );

    server.registerTool(
      "update_task",
      {
        description: "Update a task's title, body, assignee, or priority.",
        inputSchema: {
          room_id: z.string(),
          task_id: z.string().describe("task id or short #prefix from get_board"),
          title: z.string().optional(),
          body: z.string().optional(),
          assignee: z.string().optional(),
          priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
          author: z.string().optional(),
        },
      },
      async ({ room_id, task_id, title, body, assignee, priority, author }) => {
        deps.rooms.get(room_id);
        const updated = deps.board.updateTask(
          room_id,
          taskById(room_id, task_id).id,
          { title, body, assignee, priority: priority as TaskPriority | undefined },
          author ?? null,
        );
        return text(`${shortId(updated.id)} "${updated.title}" updated`);
      },
    );

    server.registerTool(
      "list_tasks",
      {
        description: "List tasks on the room's board, optionally filtered by column name or assignee.",
        inputSchema: {
          room_id: z.string(),
          column_name: z.string().optional(),
          assignee: z.string().optional(),
        },
      },
      async ({ room_id, column_name, assignee }) => {
        deps.rooms.get(room_id);
        const column = column_name ? columnByName(room_id, column_name) : null;
        const tasks = deps.board.tasks(room_id, { columnId: column?.id, assignee });
        if (tasks.length === 0) return text("no tasks");
        return text(tasks.map((t) => `${shortId(t.id)} ${t.title}${t.assignee ? ` — ${t.assignee}` : ""}`).join("\n"));
      },
    );

    server.registerTool(
      "get_task",
      {
        description: "Show one task with its event history.",
        inputSchema: {
          room_id: z.string(),
          task_id: z.string().describe("task id or short #prefix from get_board"),
        },
      },
      async ({ room_id, task_id }) => {
        deps.rooms.get(room_id);
        return renderTask(room_id, taskById(room_id, task_id).id);
      },
    );

    server.registerTool(
      "note_task",
      {
        description: "Append a progress note to a task's history without changing the task itself.",
        inputSchema: {
          room_id: z.string(),
          task_id: z.string().describe("task id or short #prefix from get_board"),
          text: z.string(),
          author: z.string().optional(),
        },
      },
      async ({ room_id, task_id, text: note, author }) => {
        deps.rooms.get(room_id);
        const event = deps.board.noteTask(room_id, taskById(room_id, task_id).id, note, author ?? null);
        return text(`noted on ${shortId(event.taskId)}: ${note}`);
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
