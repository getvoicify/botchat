import index from "./src/web/index.html";
import { EventBus } from "./src/core/bus.ts";
import { MessageService } from "./src/core/messages.ts";
import { RoomService } from "./src/core/rooms.ts";
import { openDatabase } from "./src/db/schema.ts";
import { Store } from "./src/db/store.ts";
import { createMcpHandler } from "./src/mcp/server.ts";
import { roomRoutes } from "./src/server/http.ts";
import { createSocketHandlers } from "./src/server/ws.ts";

const store = new Store(openDatabase(process.env.BOTCHAT_DB ?? "botchat.db"));
const bus = new EventBus();
const rooms = new RoomService(store);
const messages = new MessageService(store, rooms, bus);
const mcp = createMcpHandler({ rooms, messages, bus });

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4000),
  development: process.env.BOTCHAT_DEV === "1",
  // Long polls in await_messages outlive the 10s default and would log a
  // timeout warning on every call.
  idleTimeout: 30,
  routes: {
    "/": index,
    "/rooms/:id": index,
    "/mcp": { GET: mcp, POST: mcp, DELETE: mcp },
    ...roomRoutes({ rooms, messages }),
  },
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname !== "/ws") return new Response("not found", { status: 404 });
    const upgraded = server.upgrade(req, {
      data: {
        roomId: url.searchParams.get("room") ?? "",
        cursor: Number(url.searchParams.get("since") ?? 0),
        lastActivity: Date.now(),
      },
    });
    return upgraded ? undefined : new Response("expected a websocket", { status: 400 });
  },
  websocket: createSocketHandlers({ messages, bus }),
});

console.log(`BOTCHAT_LISTENING ${server.url}`);
