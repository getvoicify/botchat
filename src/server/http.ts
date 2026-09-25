import type { BunRequest } from "bun";
import type { BoardService } from "../core/board.ts";
import type { BlobStore } from "../core/blobs.ts";
import { Conflict, Invalid, NotFound } from "../core/errors.ts";
import type { MessageKind, MessageService } from "../core/messages.ts";
import type { RoomService } from "../core/rooms.ts";

const statusFor = (error: unknown): number => {
  if (error instanceof Invalid) return 400;
  if (error instanceof NotFound) return 404;
  if (error instanceof Conflict) return 409;
  return 500;
};

const body = async <T>(req: Request): Promise<T> => (await req.json()) as T;

export const guard =
  <R extends Request>(handler: (req: R) => Response | Promise<Response>) =>
  async (req: R): Promise<Response> => {
    try {
      return await handler(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unexpected error";
      return Response.json({ error: message }, { status: statusFor(error) });
    }
  };

export function roomRoutes(deps: {
  rooms: RoomService;
  messages: MessageService;
  blobs: BlobStore;
  board: BoardService;
}) {
  return {
    "/api/blobs": {
      POST: guard(async (req: BunRequest<"/api/blobs">) => {
        const bytes = new Uint8Array(await req.arrayBuffer());
        const mime = req.headers.get("content-type") ?? "";
        return Response.json(await deps.blobs.put(bytes, mime), { status: 201 });
      }),
    },
    "/api/blobs/:id": {
      GET: guard(async (req: BunRequest<"/api/blobs/:id">) => {
        const { file, record } = await deps.blobs.open(req.params.id);
        // The URL is the hash of the bytes, so the response can never change.
        return new Response(file, {
          headers: {
            "content-type": record.mime,
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      }),
    },
    "/api/rooms": {
      GET: guard(() => Response.json(deps.rooms.list())),
      POST: guard(async (req: BunRequest<"/api/rooms">) =>
        Response.json(deps.rooms.create(await body(req)), { status: 201 }),
      ),
    },
    "/api/rooms/:id": {
      GET: guard((req: BunRequest<"/api/rooms/:id">) =>
        Response.json({
          ...deps.rooms.get(req.params.id),
          participants: deps.rooms.participants(req.params.id),
        }),
      ),
      PATCH: guard(async (req: BunRequest<"/api/rooms/:id">) =>
        Response.json(
          deps.rooms.setHeartbeat(
            req.params.id,
            (await body<{ heartbeatEnabled?: boolean }>(req)).heartbeatEnabled as boolean,
          ),
        ),
      ),
    },
    "/api/rooms/:id/messages": {
      GET: guard((req: BunRequest<"/api/rooms/:id/messages">) => {
        const url = new URL(req.url);
        const roomId = req.params.id;
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);
        const before = url.searchParams.get("before");
        if (before) return Response.json(deps.messages.before(roomId, Number(before), limit));
        const since = url.searchParams.get("since");
        if (since !== null) return Response.json(deps.messages.since(roomId, Number(since), limit));
        return Response.json(deps.messages.latest(roomId, limit));
      }),
      POST: guard(async (req: BunRequest<"/api/rooms/:id/messages">) =>
        Response.json(
          deps.messages.post({
            roomId: req.params.id,
            ...(await body<{
              author: string;
              body: string;
              kind?: MessageKind;
              lang?: string | null;
              authorKind?: "human" | "bot";
              attachments?: { blobId: string; filename: string }[];
            }>(req)),
          }),
          { status: 201 },
        ),
      ),
    },
    "/api/rooms/:id/board": {
      GET: guard((req: BunRequest<"/api/rooms/:id/board">) => {
        deps.rooms.get(req.params.id); // 404 for unknown rooms, like every room route
        return Response.json(deps.board.board(req.params.id));
      }),
    },
    "/api/rooms/:id/columns": {
      POST: guard(async (req: BunRequest<"/api/rooms/:id/columns">) => {
        const roomId = req.params.id;
        deps.rooms.get(roomId);
        const input = await body<{ name?: string; names?: string[]; author?: string }>(req);
        const names = input.names ?? (input.name ? [input.name] : []);
        if (names.length === 0) throw new Invalid("name or names is required");
        const created = deps.board.defineColumns(roomId, names, input.author ?? null);
        return Response.json(names.length === 1 ? created[0] : created, { status: 201 });
      }),
    },
    "/api/rooms/:id/columns/reorder": {
      POST: guard(async (req: BunRequest<"/api/rooms/:id/columns/reorder">) => {
        const roomId = req.params.id;
        deps.rooms.get(roomId);
        const input = await body<{ ids: string[] }>(req);
        if (!Array.isArray(input.ids)) throw new Invalid("ids array is required");
        return Response.json(deps.board.reorderColumns(roomId, input.ids));
      }),
    },
    "/api/rooms/:id/columns/:columnId": {
      PATCH: guard(async (req: BunRequest<"/api/rooms/:id/columns/:columnId">) => {
        const roomId = req.params.id;
        deps.rooms.get(roomId);
        const input = await body<{ name?: string; archived?: boolean }>(req);
        const columnId = req.params.columnId;
        if (input.archived === true) return Response.json(deps.board.archiveColumn(roomId, columnId));
        if (input.name !== undefined) return Response.json(deps.board.renameColumn(roomId, columnId, input.name));
        throw new Invalid("name or archived is required");
      }),
    },
    "/api/rooms/:id/tasks": {
      GET: guard((req: BunRequest<"/api/rooms/:id/tasks">) => {
        const roomId = req.params.id;
        deps.rooms.get(roomId);
        const url = new URL(req.url);
        return Response.json(
          deps.board.tasks(roomId, {
            columnId: url.searchParams.get("columnId") ?? undefined,
            assignee: url.searchParams.get("assignee") ?? undefined,
          }),
        );
      }),
      POST: guard(async (req: BunRequest<"/api/rooms/:id/tasks">) => {
        const input = await body<{
          title: string;
          body?: string | null;
          assignee?: string | null;
          columnId?: string | null;
          priority?: "none" | "low" | "medium" | "high" | "urgent";
          author?: string;
        }>(req);
        return Response.json(
          deps.board.createTask(req.params.id, input, input.author ?? null),
          { status: 201 },
        );
      }),
    },
    "/api/rooms/:id/tasks/:taskId": {
      GET: guard((req: BunRequest<"/api/rooms/:id/tasks/:taskId">) =>
        Response.json(deps.board.task(req.params.id, req.params.taskId)),
      ),
      PATCH: guard(async (req: BunRequest<"/api/rooms/:id/tasks/:taskId">) => {
        const input = await body<{
          title?: string;
          body?: string | null;
          assignee?: string | null;
          priority?: "none" | "low" | "medium" | "high" | "urgent";
          author?: string;
        }>(req);
        return Response.json(
          deps.board.updateTask(req.params.id, req.params.taskId, input, input.author ?? null),
        );
      }),
    },
    "/api/rooms/:id/tasks/:taskId/move": {
      POST: guard(async (req: BunRequest<"/api/rooms/:id/tasks/:taskId/move">) => {
        const input = await body<{ columnId: string; author?: string }>(req);
        return Response.json(
          deps.board.moveTask(req.params.id, req.params.taskId, input.columnId, input.author ?? null),
        );
      }),
    },
    "/api/rooms/:id/tasks/:taskId/note": {
      POST: guard(async (req: BunRequest<"/api/rooms/:id/tasks/:taskId/note">) => {
        const input = await body<{ text: string; author?: string }>(req);
        return Response.json(
          deps.board.noteTask(req.params.id, req.params.taskId, input.text, input.author ?? null),
          { status: 201 },
        );
      }),
    },
  };
}
